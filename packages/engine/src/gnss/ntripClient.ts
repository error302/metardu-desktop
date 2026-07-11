/**
 * NTRIP Client — Real-Time Kinematic Corrections
 *
 * AUDIT FIX (2026-07-03): Implements an NTRIP (Networked Transport of
 * RTCM via Internet Protocol) client for receiving real-time GNSS
 * correction data from CORS networks (e.g., KENCORS in Kenya).
 *
 * Architecture:
 *   1. Browser can't do raw TCP (NTRIP protocol) — so we use a
 *      server-side proxy at /api/gnss/ntrip that connects to the
 *      NTRIP caster via TCP and streams RTCM3 messages back via
 *      Server-Sent Events (SSE).
 *   2. The browser receives the SSE stream, parses RTCM3 messages
 *      to extract correction status (satellite count, correction age),
 *      and can optionally forward corrections to a GNSS receiver via
 *      Web Serial API or Web Bluetooth.
 *
 * References:
 *   - NTRIP v2 (RTCM 10410.1)
 *   - RTCM 3.3 message format
 *   - KENCORS: Kenya Continuous Operating Reference Stations
 */

export interface NTRIPConfig {
  /** NTRIP caster host (e.g., 'ntrip.kenyacors.go.ke') */
  host: string
  /** NTRIP caster port (usually 2101 or 2102 for NTRIP v2) */
  port: number
  /** Mountpoint (e.g., 'NBI0') */
  mountpoint: string
  /** Username for authenticated access */
  username?: string
  /** Password for authenticated access */
  password?: string
}

export interface RTCMMessage {
  /** RTCM message type number (e.g., 1005, 1074, 1084) */
  type: number
  /** Message length in bytes */
  length: number
  /** Timestamp when received */
  receivedAt: string
}

export interface NTRIPStatus {
  connected: boolean
  mountpoint: string
  messagesReceived: number
  lastMessageAt: string | null
  recentMessages: RTCMMessage[]
  error: string | null
}

/**
 * RTCM3 message type names for human-readable display.
 */
export const RTCM_TYPE_NAMES: Record<number, string> = {
  1001: 'L1-Only GPS RTK Observations',
  1002: 'Extended L1-Only GPS RTK Observations',
  1003: 'L1&L2 GPS RTK Observations',
  1004: 'Extended L1&L2 GPS RTK Observations',
  1005: 'Stationary RTK Reference Station ARP',
  1006: 'Stationary RTK Reference Station ARP with Antenna Height',
  1007: 'Antenna Descriptor',
  1008: 'Antenna Descriptor & Serial Number',
  1009: 'L1-Only GLONASS RTK Observations',
  1010: 'Extended L1-Only GLONASS RTK Observations',
  1011: 'L1&L2 GLONASS RTK Observations',
  1012: 'Extended L1&L2 GLONASS RTK Observations',
  1013: 'System Parameters',
  1019: 'GPS Ephemerides',
  1020: 'GLONASS Ephemerides',
  1042: 'BeiDou Ephemerides',
  1045: 'Galileo F/NAV Ephemerides',
  1046: 'Galileo I/NAV Ephemerides',
  1071: 'GPS MSM1',
  1072: 'GPS MSM2',
  1073: 'GPS MSM3',
  1074: 'GPS MSM4 (Full)',
  1075: 'GPS MSM5 (Full)',
  1076: 'GPS MSM6 (Full)',
  1077: 'GPS MSM7 (Full)',
  1081: 'GLONASS MSM1',
  1084: 'GLONASS MSM4 (Full)',
  1087: 'GLONASS MSM7 (Full)',
  1094: 'Galileo MSM4 (Full)',
  1104: 'SBAS MSM4',
  1114: 'QZSS MSM4',
  1124: 'BeiDou MSM4 (Full)',
  1230: 'GLONASS L1&L2 Code-Phase Biases',
}

/**
 * Parse an RTCM3 message from a buffer.
 * Returns the message type and length, or null if the buffer doesn't
 * contain a complete message.
 *
 * RTCM3 frame structure:
 *   - Preamble: 0xD3 (1 byte)
 *   - Message length: 10 bits (2 bytes, upper 6 bits reserved)
 *   - Message body: N bytes
 *   - CRC24: 3 bytes
 */
export function parseRTCM3Message(buffer: Uint8Array, offset: number): RTCMMessage | null {
  if (offset + 6 > buffer.length) return null

  // Check for RTCM3 preamble (0xD3)
  if (buffer[offset] !== 0xD3) return null

  // Message length (10 bits from bytes 1-2)
  const length = ((buffer[offset + 1] & 0x03) << 8) | buffer[offset + 2]

  // Check we have the full message (preamble + length + body + CRC)
  const totalLength = 3 + length + 3
  if (offset + totalLength > buffer.length) return null

  // Message type (12 bits from first 2 bytes of body)
  const msgType = ((buffer[offset + 3] << 4) | (buffer[offset + 4] >> 4)) & 0x0FFF

  return {
    type: msgType,
    length,
    receivedAt: new Date().toISOString(),
  }
}

/**
 * Build the NTRIP HTTP request for connecting to a caster.
 * NTRIP v2 uses HTTP/1.1 with specific headers.
 */
export function buildNTRIPRequest(config: NTRIPConfig): string {
  const auth = config.username
    ? `Authorization: Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}\r\n`
    : ''

  return (
    `GET /${config.mountpoint} HTTP/1.1\r\n` +
    `Host: ${config.host}:${config.port}\r\n` +
    auth +
    `User-Agent: METARDU/1.0\r\n` +
    `Ntrip-Version: Ntrip/2.0\r\n` +
    `Accept: rtk/rtcm, ./\r\n` +
    `Connection: close\r\n` +
    `\r\n`
  )
}

/**
 * Known CORS networks in East Africa.
 */
export const CORS_NETWORKS = [
  {
    id: 'kencors',
    name: 'KENCORS (Kenya)',
    host: 'ntrip.kenyacors.go.ke',
    port: 2101,
    description: 'Kenya Continuous Operating Reference Stations — run by the Survey of Kenya. Covers Nairobi, Mombasa, Kisumu, and other major towns.',
    website: 'https://www.surveyofkenya.go.ke',
  },
  {
    id: 'tanzacors',
    name: 'TANZACORS (Tanzania)',
    host: 'ntrip.tanzacors.go.tz',
    port: 2101,
    description: 'Tanzania CORS network — run by the Ministry of Lands, Housing and Human Settlements Development.',
    website: 'https://www.ardhi.go.tz',
  },
  {
    id: 'uganda-cors',
    name: 'Uganda CORS',
    host: 'ntrip.cors.go.ug',
    port: 2101,
    description: 'Uganda Continuous Operating Reference Stations — run by the Ministry of Lands, Housing and Urban Development.',
    website: 'https://www.molhud.go.ug',
  },
  {
    id: 'custom',
    name: 'Custom NTRIP Caster',
    host: '',
    port: 2101,
    description: 'Connect to any NTRIP caster (e.g., EUREF, RTK2GO, private caster).',
    website: '',
  },
]
