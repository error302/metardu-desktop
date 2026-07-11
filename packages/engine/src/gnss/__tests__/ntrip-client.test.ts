/**
 * NTRIP Client Tests
 *
 * Tests the NTRIPClient class, Kenya CORS presets, RTCM message detection,
 * and source table parsing.
 */

import {
  NTRIPClient,
  KENYA_NTRIP_PRESETS,
  detectRTCMMessageType,
  RTCM3_MESSAGE_TYPES,
  isNTRIPAvailable,
  type NTRIPConnectionConfig,
  type NTRIPStatus,
} from '@/lib/gnss/ntrip-client'

// ─── Mock WebSocket ────────────────────────────────────────────────────────

type EventCallback = (event: any) => void

class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  static CONNECTING = 0
  static CLOSING = 2

  readyState = MockWebSocket.CONNECTING
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  send = jest.fn()
  close = jest.fn()

  private listeners: Map<string, Set<EventCallback>> = new Map()

  addEventListener(type: string, callback: EventCallback) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(callback)
  }

  removeEventListener(type: string, callback: EventCallback) {
    this.listeners.get(type)?.delete(callback)
  }

  private emit(type: string, event?: any) {
    const callbacks = this.listeners.get(type)
    if (callbacks) {
      callbacks.forEach(cb => cb(event))
    }
    // Also call the on* handler
    if (type === 'open' && this.onopen) this.onopen()
    if (type === 'message' && this.onmessage) this.onmessage(event)
    if (type === 'error' && this.onerror) this.onerror(event)
    if (type === 'close' && this.onclose) this.onclose(event)
  }

  constructor(public url: string, public protocols?: string[]) {
    // Auto-open after a microtask
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.emit('open')
    }, 10)
  }
}

// Store original WebSocket
let originalWebSocket: typeof WebSocket

beforeAll(() => {
  originalWebSocket = global.WebSocket
  ;(global as any).WebSocket = MockWebSocket as any
})

afterAll(() => {
  ;(global as any).WebSocket = originalWebSocket
})

// ─── Helper ────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<NTRIPConnectionConfig>): NTRIPConnectionConfig {
  return {
    host: 'test-cors.example.com',
    port: 2101,
    mountpoint: 'RTCM32_TEST',
    username: 'testuser',
    password: 'testpass',
    version: 2,
    secure: false,
    vrsEnabled: false,
    ...overrides,
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('NTRIPClient', () => {
  describe('constructor', () => {
    it('stores the config', () => {
      const config = makeConfig()
      const client = new NTRIPClient(config)
      expect(client.getConfig).toEqual(config)
    })

    it('starts with disconnected status', () => {
      const client = new NTRIPClient(makeConfig())
      expect(client.currentStatus).toBe('disconnected')
      expect(client.isConnected).toBe(false)
    })
  })

  describe('KENYA_NTRIP_PRESETS', () => {
    it('has all 4 Kenya CORS presets', () => {
      expect(Object.keys(KENYA_NTRIP_PRESETS)).toEqual(
        expect.arrayContaining(['MUYA', 'AGL', 'KENCORS', 'KPLC'])
      )
    })

    it('MUYA preset has correct host and port', () => {
      expect(KENYA_NTRIP_PRESETS.MUYA.host).toBe('muya-cors.com')
      expect(KENYA_NTRIP_PRESETS.MUYA.port).toBe(2101)
      expect(KENYA_NTRIP_PRESETS.MUYA.version).toBe(2)
    })

    it('KENCORS preset has Survey of Kenya host', () => {
      expect(KENYA_NTRIP_PRESETS.KENCORS.host).toBe('ntrip.surveyofkenya.go.ke')
    })

    it('all presets have required fields', () => {
      for (const [key, preset] of Object.entries(KENYA_NTRIP_PRESETS)) {
        expect(preset.name).toBeTruthy()
        expect(preset.host).toBeTruthy()
        expect(preset.port).toBeGreaterThan(0)
        expect(preset.mountpoint).toBeTruthy()
        expect(preset.version).toBeDefined()
        expect(preset.notes).toBeTruthy()
      }
    })
  })

  describe('onStatus / onCorrection / onError', () => {
    it('registers and calls status callback', async () => {
      const client = new NTRIPClient(makeConfig())
      const statusChanges: NTRIPStatus[] = []

      client.onStatus((status) => {
        statusChanges.push(status)
      })

      await client.connect()

      // Should have gone through connecting → connected
      expect(statusChanges).toContain('connecting')
      expect(statusChanges).toContain('connected')

      client.disconnect()
    })

    it('unsubscribes when returned function is called', async () => {
      const client = new NTRIPClient(makeConfig())
      const statusChanges: NTRIPStatus[] = []

      const unsub = client.onStatus((status) => {
        statusChanges.push(status)
      })

      unsub()
      await client.connect()

      // Should not have received any status changes after unsubscribe
      expect(statusChanges).toHaveLength(0)

      client.disconnect()
    })
  })

  describe('connect()', () => {
    it('transitions from connecting to connected', async () => {
      const client = new NTRIPClient(makeConfig())
      const statuses: NTRIPStatus[] = []

      client.onStatus((s) => statuses.push(s))
      await client.connect()

      expect(statuses).toEqual(['connecting', 'connected'])
      expect(client.isConnected).toBe(true)

      client.disconnect()
    })

    it('throws if already connected', async () => {
      const client = new NTRIPClient(makeConfig())
      await client.connect()

      await expect(client.connect()).rejects.toThrow('Already connected')

      client.disconnect()
    })
  })

  describe('disconnect()', () => {
    it('sets status to disconnected', async () => {
      const client = new NTRIPClient(makeConfig())
      await client.connect()
      expect(client.isConnected).toBe(true)

      client.disconnect()
      expect(client.currentStatus).toBe('disconnected')
      expect(client.isConnected).toBe(false)
    })
  })

  describe('getStats', () => {
    it('returns initial stats with zeros', () => {
      const client = new NTRIPClient(makeConfig())
      const stats = client.getStats
      expect(stats.bytesReceived).toBe(0)
      expect(stats.messagesReceived).toBe(0)
      expect(stats.connectedAt).toBeNull()
      expect(stats.lastCorrectionAt).toBeNull()
    })
  })
})

describe('detectRTCMMessageType', () => {
  it('detects RTCM 3.x preamble (0xD3)', () => {
    // Construct a minimal RTCM 3.x message for type 100
    // type = (data[3] << 4) | ((data[4] & 0xF0) >> 4)
    // 100 = 0x064, so data[3] = 0x06, data[4] = 0x40
    const data = new Uint8Array([0xD3, 0x00, 0x03, 0x06, 0x40, 0x00])
    const result = detectRTCMMessageType(data)
    expect(result).not.toBeNull()
    expect(result!.type).toBe(100)
  })

  it('returns null for too short data', () => {
    expect(detectRTCMMessageType(new Uint8Array([0xD3, 0x00]))).toBeNull()
    expect(detectRTCMMessageType(new Uint8Array([]))).toBeNull()
  })

  it('returns null for invalid preamble', () => {
    const data = new Uint8Array([0xAA, 0x00, 0x03, 0x06, 0x40, 0x00])
    expect(detectRTCMMessageType(data)).toBeNull()
  })

  it('detects message type 1074 (GPS MSM4)', () => {
    // type = (data[3] << 4) | ((data[4] & 0xF0) >> 4)
    // 1074 = 0x432, so data[3] = 0x43, data[4] = 0x20
    const data = new Uint8Array([0xD3, 0x00, 0x03, 0x43, 0x20, 0x00])
    const result = detectRTCMMessageType(data)
    expect(result).not.toBeNull()
    expect(result!.type).toBe(1074)
  })
})

describe('RTCM3_MESSAGE_TYPES', () => {
  it('contains common message types', () => {
    expect(RTCM3_MESSAGE_TYPES[1005]).toBe('Station Coordinates (No AR)')
    expect(RTCM3_MESSAGE_TYPES[1074]).toBe('GPS MSM4')
    expect(RTCM3_MESSAGE_TYPES[1127]).toBe('BDS MSM7')
    expect(RTCM3_MESSAGE_TYPES[1230]).toBe('GLONASS Code-Phase Biases')
  })

  it('has more than 30 defined types', () => {
    expect(Object.keys(RTCM3_MESSAGE_TYPES).length).toBeGreaterThan(30)
  })
})

describe('isNTRIPAvailable', () => {
  it('returns true when WebSocket is available', () => {
    // In our test environment, WebSocket is mocked
    expect(isNTRIPAvailable()).toBe(true)
  })
})
