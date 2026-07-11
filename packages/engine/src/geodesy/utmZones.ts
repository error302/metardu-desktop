export function getUTMZone(longitude: number): number {
  return Math.floor((longitude + 180) / 6) + 1
}

export function getHemisphere(latitude: number): 'N' | 'S' {
  return latitude >= 0 ? 'N' : 'S'
}

export function getUTMZoneFromLatLng(
  lat: number, 
  lng: number
): { zone: number; hemisphere: 'N' | 'S'; description: string } {
  let zone = getUTMZone(lng)
  const hemisphere = getHemisphere(lat)

  // Handle special zones for Norway
  if (lat >= 56 && lat < 64 && lng >= 3 && lng < 12) zone = 32
  if (lat >= 56 && lat < 64 && lng >= 0 && lng < 3) zone = 31

  // Svalbard special zones
  if (lat >= 72 && lat < 84) {
    if (lng >= 0 && lng < 9) zone = 31
    else if (lng >= 9 && lng < 21) zone = 33
    else if (lng >= 21 && lng < 33) zone = 35
    else if (lng >= 33 && lng < 42) zone = 37
  }

  const zoneDescriptions: Record<number, string> = {
    28: 'West Africa (Cape Verde, Senegal)',
    29: 'West Africa (Guinea, Sierra Leone)',
    30: 'West Africa (Ghana, Côte d\'Ivoire)',
    31: 'West Africa / Western Europe / Norway',
    32: 'East Africa / Central Europe',
    33: 'East Africa / Eastern Europe',
    34: 'East Africa / Middle East',
    35: 'East Africa / Eastern Europe',
    36: 'East Africa (Tanzania) / Middle East',
    37: 'East Africa (Kenya, Uganda, Tanzania)',
    38: 'East Africa / Arabian Peninsula',
    39: 'East Africa / Arabian Peninsula',
    40: 'East Africa / South Asia',
    41: 'Central Asia',
    42: 'South Asia (India, Pakistan)',
    43: 'South Asia / Nepal',
    44: 'South Asia / Bhutan',
    45: 'South Asia / Bangladesh',
    46: 'Southeast Asia (Myanmar)',
    47: 'Southeast Asia (Thailand, Vietnam)',
    48: 'Southeast Asia / China',
    49: 'East Asia / China',
    50: 'East Asia / Japan, Korea',
    51: 'East Asia',
    52: 'East Asia',
    53: 'East Asia / Indonesia',
    54: 'East Asia / Pacific',
    55: 'Australia East',
    56: 'Australia / Papua New Guinea',
    57: 'Australia West',
    58: 'New Zealand',
    59: 'New Zealand',
    60: 'Pacific',
    // Americas
    1: 'Pacific (Alaska West)',
    2: 'Pacific (Alaska)',
    3: 'USA West Coast',
    4: 'USA Mountain West',
    5: 'USA Central',
    6: 'USA Pacific',
    7: 'USA / Canada West',
    8: 'Canada / USA Central',
    9: 'Canada / USA East',
    10: 'USA West',
    11: 'USA',
    12: 'USA / Canada',
    13: 'USA / Mexico',
    14: 'Mexico / Central America',
    15: 'South America West',
    16: 'South America',
    17: 'South America',
    18: 'South America (Colombia, Peru)',
    19: 'South America (Brazil)',
    20: 'South America',
    21: 'South America',
    22: 'South America',
    23: 'South America',
    24: 'South America',
    25: 'South America',
    // Europe
    26: 'Atlantic / Scandinavia',
    27: 'Atlantic / Scandinavia',
  }

  return {
    zone,
    hemisphere,
    description: zoneDescriptions[zone] || `Zone ${zone}`
  }
}

export const allUTMZones = Array.from({ length: 60 }, (_, i) => i + 1)
