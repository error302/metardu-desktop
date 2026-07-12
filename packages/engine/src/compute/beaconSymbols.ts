import type { BeaconType, BeaconStatus, BeaconDefinition } from '@/types/deedPlan'

export const BEACON_DEFINITIONS: Record<BeaconType, BeaconDefinition> = {
  PSC: {
    type: 'PSC',
    shortCode: 'PSC',
    fullName: 'Primary Survey Control',
    regulation: 'Kenya Survey Regulations 1994, Reg 14(1)',
    isPermanent: true,
    isControlMark: true,
    defaultOrder: 'PRIMARY',
    description: 'Concrete pillar with brass plate, established by Survey of Kenya'
  },
  PSC_FLUSH: {
    type: 'PSC_FLUSH',
    shortCode: 'PSC-F',
    fullName: 'Primary Survey Control (Flush)',
    regulation: 'Kenya Survey Regulations 1994, Reg 14(2)',
    isPermanent: true,
    isControlMark: true,
    defaultOrder: 'PRIMARY',
    description: 'Primary control mark flush with ground surface'
  },
  SSC: {
    type: 'SSC',
    shortCode: 'SSC',
    fullName: 'Secondary Survey Control',
    regulation: 'Kenya Survey Regulations 1994, Reg 15(1)',
    isPermanent: true,
    isControlMark: true,
    defaultOrder: 'SECONDARY',
    description: 'Concrete pillar or bench mark of secondary order'
  },
  TSC: {
    type: 'TSC',
    shortCode: 'TSC',
    fullName: 'Tertiary Survey Control',
    regulation: 'Kenya Survey Regulations 1994, Reg 16(1)',
    isPermanent: false,
    isControlMark: true,
    defaultOrder: 'TERTIARY',
    description: 'Temporary control mark, iron pin or nail'
  },
  MASONRY_NAIL: {
    type: 'MASONRY_NAIL',
    shortCode: 'MN',
    fullName: 'Masonry Nail',
    regulation: 'Kenya Survey Regulations 1994, Reg 17(a)',
    isPermanent: false,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Nail in masonry, concrete or rock'
  },
  IRON_PIN: {
    type: 'IRON_PIN',
    shortCode: 'IP',
    fullName: 'Iron Pin',
    regulation: 'Kenya Survey Regulations 1994, Reg 17(b)',
    isPermanent: false,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Iron pin driven into ground'
  },
  WOODEN_PEG: {
    type: 'WOODEN_PEG',
    shortCode: 'WP',
    fullName: 'Wooden Peg',
    regulation: 'Kenya Survey Regulations 1994, Reg 17(c)',
    isPermanent: false,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Temporary wooden peg for boundary delineation'
  },
  CONCRETE_BEACON: {
    type: 'CONCRETE_BEACON',
    shortCode: 'CB',
    fullName: 'Concrete Beacon',
    regulation: 'Kenya Survey Regulations 1994, Reg 17(d)',
    isPermanent: true,
    isControlMark: false,
    defaultOrder: 'TERTIARY',
    description: 'Concrete boundary beacon with centre mark'
  },
  INDICATORY: {
    type: 'INDICATORY',
    shortCode: 'IND',
    fullName: 'Indicatory Beacon',
    regulation: 'Kenya Survey Regulations 1994, Reg 18',
    isPermanent: false,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Indicatory beacon (not a physical corner mark)'
  },
  RIVET: {
    type: 'RIVET',
    shortCode: 'RV',
    fullName: 'Rivet',
    regulation: 'Kenya Survey Regulations 1994, Reg 17(e)',
    isPermanent: true,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Brass or steel rivet in rock or concrete'
  },
  BM: {
    type: 'BM',
    shortCode: 'BM',
    fullName: 'Benchmark',
    regulation: 'Kenya Survey Regulations 1994, Reg 20(1)',
    isPermanent: true,
    isControlMark: true,
    defaultOrder: 'PRIMARY',
    description: 'Permanent benchmark referencing Kenya National Datum'
  },
  TBM: {
    type: 'TBM',
    shortCode: 'TBM',
    fullName: 'Temporary Benchmark',
    regulation: 'Kenya Survey Regulations 1994, Reg 20(2)',
    isPermanent: false,
    isControlMark: true,
    defaultOrder: 'SECONDARY',
    description: 'Temporary benchmark for short-term surveys'
  },
  FLUSH_BRACKET: {
    type: 'FLUSH_BRACKET',
    shortCode: 'FB',
    fullName: 'Flush Bracket',
    regulation: 'Kenya Survey Regulations 1994, Reg 20(3)',
    isPermanent: true,
    isControlMark: true,
    defaultOrder: 'PRIMARY',
    description: 'Flush bracket on wall or permanent structure'
  },
  ROAD_NAIL: {
    type: 'ROAD_NAIL',
    shortCode: 'RN',
    fullName: 'Road Nail',
    regulation: 'Kenya Survey Regulations 1994, Reg 21',
    isPermanent: false,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Nail in tarmac or paved surface'
  },
  SPIKE: {
    type: 'SPIKE',
    shortCode: 'SP',
    fullName: 'Railway Spike',
    regulation: 'Kenya Survey Regulations 1994, Reg 21',
    isPermanent: false,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Railway spike used as temporary mark'
  },
  NATURAL_FEATURE: {
    type: 'NATURAL_FEATURE',
    shortCode: 'NF',
    fullName: 'Natural Feature',
    regulation: 'Kenya Survey Regulations 1994, Reg 22',
    isPermanent: true,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Tree, rock face or natural feature used as reference'
  },
  FENCE_POST: {
    type: 'FENCE_POST',
    shortCode: 'FP',
    fullName: 'Fence Post',
    regulation: 'Kenya Survey Regulations 1994, Reg 22',
    isPermanent: false,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Fence post marking boundary corner'
  },
  WALL_CORNER: {
    type: 'WALL_CORNER',
    shortCode: 'WC',
    fullName: 'Wall Corner',
    regulation: 'Kenya Survey Regulations 1994, Reg 22',
    isPermanent: true,
    isControlMark: false,
    defaultOrder: 'DETAIL',
    description: 'Corner of permanent wall or structure'
  }
}

export const BEACON_IMAGES: Partial<Record<BeaconType, string>> = {
  PSC: '/images/beacons/psc.jpg',
  SSC: '/images/beacons/ssc.jpg',
  TSC: '/images/beacons/tsc.jpg',
  CONCRETE_BEACON: '/images/beacons/concrete-beacon.jpg',
  MASONRY_NAIL: '/images/beacons/masonry-nail.jpg',
  FLUSH_BRACKET: '/images/beacons/flush-bracket.jpg',
}

export function getBeaconLabel(type: BeaconType): string {
  return BEACON_DEFINITIONS[type]?.shortCode || '??'
}

export function getBeaconColor(type: BeaconType, status?: BeaconStatus): string {
  if (status === 'DESTROYED') return '#dc2626'
  if (status === 'NOT_FOUND') return '#9ca3af'
  
  const def = BEACON_DEFINITIONS[type]
  if (!def) return '#000000'
  
  if (def.type === 'BM' || def.type === 'TBM') return '#059669'
  if (def.isControlMark) return '#1d4ed8'
  return '#000000'
}

export function getBeaconSymbol(type: BeaconType, status: BeaconStatus = 'FOUND', size: number = 8): string {
  const halfSize = size / 2
  const strokeWidth = Math.max(0.5, size / 16)
  const isFound = status === 'FOUND'
  const isSet = status === 'SET'
  const isDestroyed = status === 'DESTROYED'
  const isNotFound = status === 'NOT_FOUND'
  const isReferenced = status === 'REFERENCED'

  const baseSymbol = (() => {
    switch (type) {
      case 'PSC':
        return isFound
          ? `<circle cx="0" cy="0" r="${halfSize}" fill="black" />`
          : `<circle cx="0" cy="0" r="${halfSize}" fill="none" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'PSC_FLUSH':
        return isFound
          ? `<circle cx="0" cy="0" r="${halfSize}" fill="none" stroke="black" stroke-width="${strokeWidth}" /><line x1="-${halfSize}" y1="0" x2="${halfSize}" y2="0" stroke="black" stroke-width="${strokeWidth}" />`
          : `<circle cx="0" cy="0" r="${halfSize}" fill="none" stroke="black" stroke-width="${strokeWidth}" stroke-dasharray="2,2" /><line x1="-${halfSize}" y1="0" x2="${halfSize}" y2="0" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'SSC':
        const squareSize = halfSize * 0.85
        return isFound
          ? `<rect x="-${squareSize}" y="-${squareSize}" width="${squareSize * 2}" height="${squareSize * 2}" fill="black" />`
          : `<rect x="-${squareSize}" y="-${squareSize}" width="${squareSize * 2}" height="${squareSize * 2}" fill="none" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'TSC':
        return isFound
          ? `<polygon points="0,-${halfSize} ${halfSize},${halfSize * 0.5} -${halfSize},${halfSize * 0.5}" fill="black" />`
          : `<polygon points="0,-${halfSize} ${halfSize},${halfSize * 0.5} -${halfSize},${halfSize * 0.5}" fill="none" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'MASONRY_NAIL':
        return `<line x1="-${halfSize/2}" y1="-${halfSize/2}" x2="${halfSize/2}" y2="${halfSize/2}" stroke="black" stroke-width="${strokeWidth * 2}" /><line x1="-${halfSize/2}" y1="${halfSize/2}" x2="${halfSize/2}" y2="-${halfSize/2}" stroke="black" stroke-width="${strokeWidth * 2}" />`
      
      case 'IRON_PIN':
        return `<circle cx="0" cy="0" r="${halfSize * 0.35}" fill="none" stroke="black" stroke-width="${strokeWidth}" /><line x1="0" y1="-${halfSize * 0.35}" x2="0" y2="${halfSize * 0.35}" stroke="black" stroke-width="${strokeWidth}" /><line x1="-${halfSize * 0.35}" y1="0" x2="${halfSize * 0.35}" y2="0" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'WOODEN_PEG':
        const diamondSize = halfSize * 0.7
        return `<polygon points="0,-${diamondSize} ${diamondSize},0 0,${diamondSize} -${diamondSize},0" fill="none" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'CONCRETE_BEACON':
        const cbSize = halfSize * 0.7
        return `<rect x="-${cbSize}" y="-${cbSize}" width="${cbSize * 2}" height="${cbSize * 2}" fill="black" /><circle cx="0" cy="0" r="${cbSize * 0.3}" fill="white" />`
      
      case 'INDICATORY':
        return `<circle cx="0" cy="0" r="${halfSize}" fill="none" stroke="black" stroke-width="${strokeWidth}" /><circle cx="0" cy="0" r="${halfSize * 0.3}" fill="black" />`
      
      case 'RIVET':
        return `<circle cx="0" cy="0" r="${halfSize * 0.4}" fill="black" />`
      
      case 'BM':
        return `<polygon points="0,-${halfSize} ${halfSize},${halfSize * 0.5} -${halfSize},${halfSize * 0.5}" fill="black" /><line x1="-${halfSize}" y1="${halfSize * 0.5}" x2="${halfSize}" y2="${halfSize * 0.5}" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'TBM':
        return `<polygon points="0,-${halfSize} ${halfSize},${halfSize * 0.5} -${halfSize},${halfSize * 0.5}" fill="none" stroke="black" stroke-width="${strokeWidth}" /><line x1="-${halfSize}" y1="${halfSize * 0.5}" x2="${halfSize}" y2="${halfSize * 0.5}" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'FLUSH_BRACKET':
        return `<rect x="-${halfSize}" y="-${halfSize * 0.25}" width="${halfSize * 2}" height="${halfSize * 0.5}" fill="none" stroke="black" stroke-width="${strokeWidth}" /><line x1="-${halfSize}" y1="0" x2="${halfSize}" y2="0" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'ROAD_NAIL':
        return `<line x1="-${halfSize/2}" y1="-${halfSize/2}" x2="${halfSize/2}" y2="${halfSize/2}" stroke="black" stroke-width="${strokeWidth * 2}" /><line x1="-${halfSize/2}" y1="${halfSize/2}" x2="${halfSize/2}" y2="-${halfSize/2}" stroke="black" stroke-width="${strokeWidth * 2}" />`
      
      case 'SPIKE':
        return `<line x1="0" y1="-${halfSize}" x2="0" y2="${halfSize * 0.3}" stroke="black" stroke-width="${strokeWidth * 1.5}" /><polygon points="0,${halfSize * 0.3} -${halfSize * 0.3},${halfSize} 0,${halfSize * 0.7} ${halfSize * 0.3},${halfSize}" fill="black" />`
      
      case 'NATURAL_FEATURE':
        return `<path d="M0,-${halfSize} Q${halfSize/2},-${halfSize/2} ${halfSize},0 Q${halfSize/2},${halfSize/2} 0,${halfSize} Q-${halfSize/2},${halfSize/2} -${halfSize},0 Q-${halfSize/2},-${halfSize/2} 0,-${halfSize}" fill="none" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'FENCE_POST':
        return `<rect x="-${halfSize * 0.4}" y="-${halfSize}" width="${halfSize * 0.8}" height="${halfSize * 2}" fill="none" stroke="black" stroke-width="${strokeWidth}" /><line x1="-${halfSize * 0.2}" y1="-${halfSize * 0.5}" x2="${halfSize * 0.2}" y2="-${halfSize * 0.5}" stroke="black" stroke-width="${strokeWidth}" /><line x1="-${halfSize * 0.2}" y1="${halfSize * 0.5}" x2="${halfSize * 0.2}" y2="${halfSize * 0.5}" stroke="black" stroke-width="${strokeWidth}" />`
      
      case 'WALL_CORNER':
        return `<polyline points="-${halfSize},-${halfSize} -${halfSize},${halfSize} ${halfSize},${halfSize}" fill="none" stroke="black" stroke-width="${strokeWidth}" />`
      
      default:
        return `<circle cx="0" cy="0" r="${halfSize * 0.5}" fill="black" />`
    }
  })()

  let statusModifier = ''
  if (isDestroyed) {
    statusModifier = `<line x1="-${halfSize}" y1="-${halfSize}" x2="${halfSize}" y2="${halfSize}" stroke="#dc2626" stroke-width="${strokeWidth * 1.5}" /><line x1="-${halfSize}" y1="${halfSize}" x2="${halfSize}" y2="-${halfSize}" stroke="#dc2626" stroke-width="${strokeWidth * 1.5}" />`
  } else if (isNotFound) {
    statusModifier = `<circle cx="0" cy="0" r="${halfSize * 1.3}" fill="none" stroke="#9ca3af" stroke-width="${strokeWidth}" stroke-dasharray="2,2" />`
  }

  let referenceLabel = ''
  if (isReferenced) {
    referenceLabel = `<text x="${halfSize * 0.8}" y="${halfSize * 0.8}" font-size="${halfSize * 0.5}" fill="#666">R</text>`
  }

  const def = BEACON_DEFINITIONS[type]
  const fullName = def?.fullName || 'Unknown'
  const regulation = def?.regulation || ''

  return `${baseSymbol}${statusModifier}${referenceLabel}<title>${fullName} — ${status}</title>`
}

export function getBeaconSymbolSVG(type: BeaconType, status: BeaconStatus = 'FOUND', size: number = 8): string {
  const extent = size * 0.75
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-extent} ${-extent} ${extent * 2} ${extent * 2}">${getBeaconSymbol(type, status, size)}</svg>`
}

export const BEACON_CATEGORIES = {
  CONTROL: ['PSC', 'PSC_FLUSH', 'SSC', 'TSC'] as const,
  BOUNDARY: ['MASONRY_NAIL', 'IRON_PIN', 'WOODEN_PEG', 'CONCRETE_BEACON', 'INDICATORY', 'RIVET'] as const,
  LEVEL: ['BM', 'TBM', 'FLUSH_BRACKET'] as const,
  ROAD: ['ROAD_NAIL', 'SPIKE'] as const,
  SPECIAL: ['NATURAL_FEATURE', 'FENCE_POST', 'WALL_CORNER'] as const
}

export const PERMANENT_MARKS: BeaconType[] = [
  'PSC', 'PSC_FLUSH', 'SSC', 'CONCRETE_BEACON', 'RIVET', 'BM', 'FLUSH_BRACKET', 'NATURAL_FEATURE', 'WALL_CORNER'
]

export const CONTROL_MARKS: BeaconType[] = [
  'PSC', 'PSC_FLUSH', 'SSC', 'TSC', 'BM', 'TBM', 'FLUSH_BRACKET'
]
