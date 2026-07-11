export interface CORSStation {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lng: number;
  utmZone: string;
  /** EPSG code for the Arc 1960 UTM zone */
  arc1960Epsg: string;
  /** EPSG code for the WGS84 UTM zone */
  wgs84Epsg: string;
  status: 'active' | 'inactive' | 'intermittent';
  url?: string;
}

export const KENYA_CORS_STATIONS: CORSStation[] = [
  { id: 'NAIROBI', name: 'Nairobi', operator: 'Survey of Kenya', lat: -1.2921, lng: 36.8219, utmZone: '37S', arc1960Epsg: 'EPSG:21037', wgs84Epsg: 'EPSG:32737', status: 'active' },
  { id: 'MOMBASA', name: 'Mombasa', operator: 'Survey of Kenya', lat: -4.0435, lng: 39.6682, utmZone: '37S', arc1960Epsg: 'EPSG:21037', wgs84Epsg: 'EPSG:32737', status: 'active' },
  { id: 'KISUMU', name: 'Kisumu', operator: 'Survey of Kenya', lat: -0.0917, lng: 34.7680, utmZone: '36S', arc1960Epsg: 'EPSG:21036', wgs84Epsg: 'EPSG:32736', status: 'active' },
  { id: 'NAKURU', name: 'Nakuru', operator: 'Survey of Kenya', lat: -0.3031, lng: 36.0800, utmZone: '37S', arc1960Epsg: 'EPSG:21037', wgs84Epsg: 'EPSG:32737', status: 'active' },
  { id: 'ELDORET', name: 'Eldoret', operator: 'Survey of Kenya', lat: 0.5143, lng: 35.2698, utmZone: '36S', arc1960Epsg: 'EPSG:21036', wgs84Epsg: 'EPSG:32736', status: 'active' },
  { id: 'GARISSA', name: 'Garissa', operator: 'Survey of Kenya', lat: -0.4536, lng: 39.6401, utmZone: '37S', arc1960Epsg: 'EPSG:21037', wgs84Epsg: 'EPSG:32737', status: 'intermittent' },
  { id: 'KISII', name: 'Kisii', operator: 'Survey of Kenya', lat: -0.6817, lng: 34.7667, utmZone: '36S', arc1960Epsg: 'EPSG:21036', wgs84Epsg: 'EPSG:32736', status: 'active' },
  { id: 'MALINDI', name: 'Malindi', operator: 'KeNHA', lat: -3.2175, lng: 40.1169, utmZone: '37S', arc1960Epsg: 'EPSG:21037', wgs84Epsg: 'EPSG:32737', status: 'active' },
];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface NearestCORSResult {
  station: CORSStation;
  distanceKm: number;
  baselineQualityNote: string;
}

export function findNearestCORS(lat: number, lng: number, maxResults = 3): NearestCORSResult[] {
  return KENYA_CORS_STATIONS
    .map((station) => {
      const distanceKm = haversineKm(lat, lng, station.lat, station.lng);
      let baselineQualityNote = '';
      if (distanceKm < 30) baselineQualityNote = 'Excellent — baseline under 30 km';
      else if (distanceKm < 60) baselineQualityNote = 'Good — baseline under 60 km';
      else if (distanceKm < 100) baselineQualityNote = 'Acceptable — consider longer occupation time';
      else baselineQualityNote = 'Long baseline — use static GNSS, minimum 2 hrs occupation';
      return { station, distanceKm: Math.round(distanceKm * 10) / 10, baselineQualityNote };
    })
    .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
    .slice(0, maxResults);
}

/**
 * Get the recommended projection (Arc 1960 EPSG code) based on the nearest CORS station.
 * Useful for determining whether to use EPSG:21036 (Zone 36) or EPSG:21037 (Zone 37).
 */
export function getRecommendedProjection(lat: number, lng: number): { arc1960Epsg: string; wgs84Epsg: string; zone: string } {
  const nearest = findNearestCORS(lat, lng, 1)
  if (nearest.length > 0) {
    const station = nearest[0].station
    return {
      arc1960Epsg: station.arc1960Epsg,
      wgs84Epsg: station.wgs84Epsg,
      zone: station.utmZone,
    }
  }
  // Fallback: use longitude-based detection
  const zone = lng < 36 ? '36S' : '37S'
  return {
    arc1960Epsg: zone === '36S' ? 'EPSG:21036' : 'EPSG:21037',
    wgs84Epsg: zone === '36S' ? 'EPSG:32736' : 'EPSG:32737',
    zone,
  }
}
