import { 
  endAreaVolume, 
  prismoidalVolume, 
  volumeFromSections, 
  cutFillVolumeFromSignedSections,
  VolumeMethod,
  VolumeSection,
  CutFillVolumeResult,
  VolumeResult 
} from '../engine/volume';

export interface VolumeComputeInput {
  sections: Array<{ chainage: number; area: number }>;
  method: VolumeMethod;
}

export function computeVolume(input: VolumeComputeInput): VolumeResult {
  return volumeFromSections(input.sections, input.method);
}

export function computeCutFillVolume(sections: Array<{ chainage: number; area: number }>): CutFillVolumeResult {
  return cutFillVolumeFromSignedSections(sections);
}

export function getVolumeSummary(result: VolumeResult): {
  total: string;
  method: string;
} {
  return {
    total: `${result.totalVolume.toFixed(2)} m³`,
    method: result.method === 'prismoidal' ? 'Prismoidal Formula' : 'End Area Method',
  };
}

export function getCutFillSummary(result: CutFillVolumeResult): {
  cut: string;
  fill: string;
  net: string;
} {
  return {
    cut: `${result.cutVolume.toFixed(2)} m³`,
    fill: `${result.fillVolume.toFixed(2)} m³`,
    net: `${result.netVolume.toFixed(2)} m³`,
  };
}
