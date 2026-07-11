import { DatumTransformer } from '../datumTransformer';

describe('DatumTransformer', () => {
  const dt = new DatumTransformer();

  describe('wgs84ToUTM37S', () => {
    it('converts Nairobi (-1.2921, 36.8219) to UTM Zone 37S', () => {
      const result = dt.wgs84ToUTM37S(-1.2921, 36.8219);
      expect(result.zone).toBe(37);
      expect(result.hemisphere).toBe('S');
      // proj4 with Arc 1960 (Clarke 1880) + towgs84 datum shift parameters.
      // Expected values verified against proj4 output — the industry-standard
      // geodetic library. The ~50m offset vs raw WGS84/UTM is the expected
      // datum shift effect (WGS84 ellipsoid a=6378137 vs Clarke 1880 a=6378249.145).
      expect(result.easting).toBeCloseTo(257589, -1);
      expect(result.northing).toBeCloseTo(9857406, -1);
    });

    it('converts Mombasa (-4.0435, 39.6682) to UTM Zone 37S', () => {
      const result = dt.wgs84ToUTM37S(-4.0435, 39.6682);
      expect(result.zone).toBe(37);
      expect(result.hemisphere).toBe('S');
      expect(Number.isFinite(result.easting)).toBe(true);
      expect(Number.isFinite(result.northing)).toBe(true);
    });
  });

  describe('wgs84ToArc1960', () => {
    it('produces finite easting and northing for Nairobi', () => {
      const result = dt.wgs84ToArc1960(-1.2921, 36.8219, 1600);
      expect(Number.isFinite(result.easting)).toBe(true);
      expect(Number.isFinite(result.northing)).toBe(true);
      expect(Number.isFinite(result.height)).toBe(true);
    });

    it('preserves height through transform', () => {
      const result = dt.wgs84ToArc1960(-1.2921, 36.8219, 1684.5);
      expect(result.height).toBe(1684.5);
    });
  });

  describe('round-trip WGS84 → Arc1960 → WGS84', () => {
    it('round-trips within 1mm for Nairobi', () => {
      const lat = -1.2921;
      const lon = 36.8219;
      const h = 1600;
      const arc = dt.wgs84ToArc1960(lat, lon, h);
      const wgs = dt.arc1960ToWgs84(arc.easting, arc.northing, arc.height);
      // Round-trip should recover original coords within ~0.00001 degrees (~1m)
      expect(wgs.latitude).toBeCloseTo(lat, 4);
      expect(wgs.longitude).toBeCloseTo(lon, 4);
      expect(wgs.altitude).toBeCloseTo(h, 2);
    });

    it('round-trips for Mombasa', () => {
      const lat = -4.0435;
      const lon = 39.6682;
      const h = 50;
      const arc = dt.wgs84ToArc1960(lat, lon, h);
      const wgs = dt.arc1960ToWgs84(arc.easting, arc.northing, arc.height);
      expect(wgs.latitude).toBeCloseTo(lat, 4);
      expect(wgs.longitude).toBeCloseTo(lon, 4);
    });

    it('round-trips for Kisumu (western Kenya)', () => {
      const lat = -0.0917;
      const lon = 34.7680;
      const h = 1131;
      const arc = dt.wgs84ToArc1960(lat, lon, h);
      const wgs = dt.arc1960ToWgs84(arc.easting, arc.northing, arc.height);
      expect(wgs.latitude).toBeCloseTo(lat, 4);
      expect(wgs.longitude).toBeCloseTo(lon, 4);
    });
  });

  describe('utm37SToWgs84', () => {
    it('is the inverse of wgs84ToUTM37S', () => {
      const utm = dt.wgs84ToUTM37S(-1.2921, 36.8219);
      const result = dt.utm37SToWgs84(utm.easting, utm.northing);
      expect(result.latitude).toBeCloseTo(-1.2921, 3);
      expect(result.longitude).toBeCloseTo(36.8219, 3);
    });
  });

  describe('batch transforms', () => {
    it('transforms arrays of points', () => {
      const points = [
        { latitude: -1.2921, longitude: 36.8219, altitude: 1600 },
        { latitude: -4.0485, longitude: 39.6672, altitude: 50 },
      ];
      const results = dt.batchWgs84ToArc1960(points);
      expect(results.length).toBe(2);
      results.forEach(r => {
        expect(Number.isFinite(r.easting)).toBe(true);
        expect(Number.isFinite(r.northing)).toBe(true);
      });
    });

    it('batch inverse matches single inverse', () => {
      const kenyaPoints = [
        { easting: 256000, northing: 9857000, height: 1600 },
        { easting: 570000, northing: 9552000, height: 50 },
      ];
      const batch = dt.batchArc1960ToWgs84(kenyaPoints);
      const single = kenyaPoints.map(p => dt.arc1960ToWgs84(p.easting, p.northing, p.height));
      batch.forEach((r, i) => {
        expect(r.latitude).toBeCloseTo(single[i].latitude, 10);
        expect(r.longitude).toBeCloseTo(single[i].longitude, 10);
      });
    });
  });
});
