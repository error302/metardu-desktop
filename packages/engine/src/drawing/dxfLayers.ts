/**
 * DXF layer definitions — stub for desktop engine.
 * The upstream metardu has a full SoK (Survey of Kenya) layer registry.
 * For the desktop fork we provide a minimal layer set that the DXF
 * exporter can use. M5 will port the full layer registry.
 */

export interface DXFLayerDef {
  name: string;
  color: number;
  lineType: string;
  lineWeight: number;
}

export const DXF_LAYERS: Record<string, DXFLayerDef> = {
  CONTROL: { name: 'CONTROL', color: 1, lineType: 'CONTINUOUS', lineWeight: 0 },
  SPOT: { name: 'SPOT', color: 2, lineType: 'CONTINUOUS', lineWeight: 0 },
  BEACON: { name: 'BEACON', color: 3, lineType: 'CONTINUOUS', lineWeight: 0 },
  BEACON_TXT: { name: 'BEACON-TXT', color: 7, lineType: 'CONTINUOUS', lineWeight: 0 },
  POINTS: { name: 'POINTS', color: 7, lineType: 'CONTINUOUS', lineWeight: 0 },
  PARCEL_BOUNDARY: { name: 'PARCEL-BOUNDARY', color: 1, lineType: 'CONTINUOUS', lineWeight: 0 },
  TRAVERSE: { name: 'TRAVERSE', color: 5, lineType: 'CONTINUOUS', lineWeight: 0 },
  CONTOURS: { name: 'CONTOURS', color: 8, lineType: 'CONTINUOUS', lineWeight: 0 },
  INDEX_CONTOURS: { name: 'INDEX-CONTOURS', color: 6, lineType: 'CONTINUOUS', lineWeight: 0 },
  TEXT: { name: 'TEXT', color: 7, lineType: 'CONTINUOUS', lineWeight: 0 },
  GRID: { name: 'GRID', color: 9, lineType: 'DOT', lineWeight: 0 },
};

export function initialiseSokDXFLayers(drawing?: any): void {
  // No-op for the desktop stub. The full SoK layer registry will be
  // ported in M5 when we wire the complete DXF export pipeline.
  // The drawing parameter is accepted for API compatibility with the
  // upstream metardu's initialiseSokDXFLayers(drawing) call.
}
