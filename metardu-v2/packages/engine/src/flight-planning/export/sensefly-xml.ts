/**
 * senseFly eMotion XML mission export.
 *
 * Generates an XML file compatible with senseFly eMotion (used by eBee X
 * and other fixed-wing survey drones).
 *
 * Format: proprietary XML schema with a Mission element containing
 * Waypoint children, each with Position (latitude, longitude, altitude
 * Above Sea Level), PhotoAction, and TriggerDistance elements.
 *
 * Reference: senseFly eMotion mission export format (reverse-engineered
 * from sample missions; senseFly does not publish the schema publicly).
 */

import type { Waypoint } from "../waypoints.js";

export interface SenseflyXmlOptions {
  /**
   * Mission name. Default: "MetaRDU Mission".
   */
  missionName?: string;
  /**
   * Default cruise speed in m/s. Default: 15.
   */
  defaultSpeedMs?: number;
  /**
   * Ground sampling distance in cm/px (optional, included in metadata).
   */
  gsdCmPx?: number;
}

/**
 * Generate senseFly eMotion XML content as a string.
 */
export function exportSenseflyXml(
  waypoints: Waypoint[],
  options: SenseflyXmlOptions = {}
): string {
  if (waypoints.length === 0) {
    throw new Error("Cannot export senseFly XML: waypoints array is empty");
  }

  const missionName = options.missionName ?? "MetaRDU Mission";
  const defaultSpeed = options.defaultSpeedMs ?? 15;
  const gsd = options.gsdCmPx ?? 0;

  const waypointXml = waypoints.map((wp, i) => {
    const speed = wp.speedMs ?? defaultSpeed;
    const gimbalPitch = wp.gimbalPitchDegrees ?? -90;
    return `    <Waypoint Index="${i}">
      <Position Latitude="${wp.latitude.toFixed(8)}" Longitude="${wp.longitude.toFixed(8)}" Altitude="${wp.altitudeMeters.toFixed(2)}" AltitudeType="AboveSeaLevel"/>
      <PhotoAction TakePhoto="true" StopAndTurn="false"/>
      <TriggerDistance>${(wp.speedMs ?? defaultSpeed).toFixed(2)}</TriggerDistance>
      <Speed>${speed.toFixed(2)}</Speed>
      <GimbalPitch>${gimbalPitch.toFixed(0)}</GimbalPitch>
      <Curvesize>0</Curvesize>
      <RotationDirection>0</RotationDirection>
    </Waypoint>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<Mission Name="${escapeXml(missionName)}" Version="1.0" Creator="MetaRDU Desktop v2.0">
  <MissionInfo>
    <WaypointCount>${waypoints.length}</WaypointCount>
    <GSDCmPx>${gsd.toFixed(2)}</GSDCmPx>
    <DefaultSpeedMs>${defaultSpeed.toFixed(2)}</DefaultSpeedMs>
  </MissionInfo>
  <Waypoints>
${waypointXml}
  </Waypoints>
</Mission>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
