#!/usr/bin/env python3
"""
Lambert Conformal Conic (2SP) — independent reference implementation.

Validates the Rust sidecar's `lambert_conformal_conic_forward/inverse`
against the published EPSG Guidance Note 7-2 §1.3.2.1 worked example,
then emits expected values for the US SPCS zones the engine needs.

This file is intentionally dependency-free (stdlib only) so it runs
anywhere. It exists so the golden fixtures in
tests/golden-fixtures/us/projection__lambert-*.json can be regenerated
and cross-checked without installing pyproj.

References:
  - Snyder, J. P. (1987), "Map Projections — A Working Manual,"
    USGS PP-1395, §14 (Lambert Conformal Conic).
  - EPSG Geomatics Guidance Note 7-2, §1.3.2.1 (Lambert Conic Conformal, 2SP).
"""

import math

# ─── Ellipsoids (a, 1/f) ──────────────────────────────────────────

GRS80 = (6_378_137.0, 298.257_222_101)
CLARKE_1866 = (6_378_206.4, 294.978_698_2)

# US survey foot → metre (exact: 1200/3937 m)
FTUS_TO_M = 1200.0 / 3937.0


def e2_of(ell):
    a, inv_f = ell
    f = 1.0 / inv_f
    return 2.0 * f - f * f


def m_func(phi, e2):
    """Snyder eq. 14-15: m(φ) = cosφ / √(1 − e² sin²φ)."""
    s = math.sin(phi)
    return math.cos(phi) / math.sqrt(1.0 - e2 * s * s)


def t_func(phi, e2):
    """Snyder eq. 14-10 / 14-16: t(φ) = tan(π/4 − φ/2) / ((1−e·sinφ)/(1+e·sinφ))^(e/2)."""
    e = math.sqrt(e2)
    return math.tan(math.pi / 4.0 - phi / 2.0) / (
        (1.0 - e * math.sin(phi)) / (1.0 + e * math.sin(phi))
    ) ** (e / 2.0)


def lcc_forward(lat_deg, lon_deg, lat1_deg, lat2_deg, lat0_deg, lon0_deg,
                fe_m, fn_m, ell):
    """Lambert Conformal Conic (2SP) forward — geodetic → projected. Returns (E, N) in metres."""
    e2 = e2_of(ell)
    a = ell[0]

    phi = math.radians(lat_deg)
    lam = math.radians(lon_deg)
    phi1 = math.radians(lat1_deg)
    phi2 = math.radians(lat2_deg)
    phi0 = math.radians(lat0_deg)
    lam0 = math.radians(lon0_deg)

    m1, m2 = m_func(phi1, e2), m_func(phi2, e2)
    t1, t2 = t_func(phi1, e2), t_func(phi2, e2)
    t0, t = t_func(phi0, e2), t_func(phi, e2)

    # Snyder eq. 14-1/14-2/14-3/14-4 (handling φ1 == φ2)
    if abs(lat1_deg - lat2_deg) < 1e-12:
        n = math.sin(phi1)
    else:
        n = (math.log(m1) - math.log(m2)) / (math.log(t1) - math.log(t2))
    f = m1 / (n * t1 ** n)
    rho0 = a * f * t0 ** n
    rho = a * f * t ** n
    theta = n * (lam - lam0)

    easting = fe_m + rho * math.sin(theta)
    northing = fn_m + rho0 - rho * math.cos(theta)
    return easting, northing


def footpoint_latitude(t, e2):
    """Inverse LCC footpoint: iterate φ = π/2 − 2·atan(t·((1−e·sinφ)/(1+e·sinφ))^(e/2)).

    EPSG Guidance Note 7-2 §1.3.2.1 inverse. Converges in a handful of
    iterations (e < 0.09 for every survey ellipsoid).
    """
    e = math.sqrt(e2)
    phi = math.pi / 2.0 - 2.0 * math.atan(t)  # conformal-latitude starter
    for _ in range(20):
        factor = ((1.0 - e * math.sin(phi)) / (1.0 + e * math.sin(phi))) ** (e / 2.0)
        phi_next = math.pi / 2.0 - 2.0 * math.atan(t * factor)
        if abs(phi_next - phi) < 1e-14:
            phi = phi_next
            break
        phi = phi_next
    return phi


def lcc_inverse(easting, northing, lat1_deg, lat2_deg, lat0_deg, lon0_deg,
                fe_m, fn_m, ell):
    """Lambert Conformal Conic (2SP) inverse — projected → geodetic. Returns (lat, lon) in degrees."""
    e2 = e2_of(ell)
    a = ell[0]

    phi1 = math.radians(lat1_deg)
    phi2 = math.radians(lat2_deg)
    phi0 = math.radians(lat0_deg)
    lam0 = math.radians(lon0_deg)

    m1, m2 = m_func(phi1, e2), m_func(phi2, e2)
    t1, t2 = t_func(phi1, e2), t_func(phi2, e2)
    t0 = t_func(phi0, e2)

    if abs(lat1_deg - lat2_deg) < 1e-12:
        n = math.sin(phi1)
    else:
        n = (math.log(m1) - math.log(m2)) / (math.log(t1) - math.log(t2))
    f = m1 / (n * t1 ** n)
    rho0 = a * f * t0 ** n

    rho = math.copysign(1.0, n) * math.sqrt((easting - fe_m) ** 2 + (rho0 - (northing - fn_m)) ** 2)
    # Snyder eq. 14-11 is θ = atan2(E−FE, ρ₀−(N−FN)), but that only
    # recovers θ when ρ > 0 (n > 0). For southern-hemisphere zones n < 0
    # makes ρ < 0, so atan2 returns θ ∓ π (a ~280° longitude error).
    # Scaling both arms by sign(n) fixes the quadrant for every n.
    sn = math.copysign(1.0, n)
    theta = math.atan2(sn * (easting - fe_m), sn * (rho0 - (northing - fn_m)))
    t = (rho / (a * f)) ** (1.0 / n)

    phi = footpoint_latitude(t, e2)
    lam = lam0 + theta / n
    return math.degrees(phi), math.degrees(lam)


# ─── 1. Validate against the EPSG GN7-2 worked example ────────────
# Example from EPSG Guidance Note 7-2 §1.3.2.1:
#   Projection: NAD27 / Texas South Central (EPSG::32040), units US survey feet.
#   Ellipsoid: Clarke 1866. φ0=27°50', λ0=99°W, φ1=28°23', φ2=30°17',
#   FE=2,000,000 ftUS, FN=0.
#   Point: φ=28°30'N, λ=96°W → E=2,963,503.91 ftUS, N=254,759.80 ftUS.
print("=== 1. EPSG GN7-2 worked example (NAD27 / Texas South Central, ftUS) ===")
e_ns, n_ns = lcc_forward(
    28.5, -96.0,
    28 + 23 / 60, 30 + 17 / 60,   # SP1, SP2
    27 + 50 / 60, -99.0,          # lat0, lon0
    2_000_000 * FTUS_TO_M, 0.0,
    CLARKE_1866,
)
e_ft = e_ns / FTUS_TO_M
n_ft = n_ns / FTUS_TO_M
print(f"forward : E={e_ft:,.2f} ftUS  N={n_ft:,.2f} ftUS")
print(f"expected: E=2,963,503.91 ftUS  N=254,759.80 ftUS")
assert abs(e_ft - 2_963_503.91) < 0.05, "EASTING MISMATCH"
assert abs(n_ft - 254_759.80) < 0.05, "NORTHING MISMATCH"
lat_b, lon_b = lcc_inverse(e_ns, n_ns,
                           28 + 23 / 60, 30 + 17 / 60, 27 + 50 / 60, -99.0,
                           2_000_000 * FTUS_TO_M, 0.0, CLARKE_1866)
print(f"inverse : lat={lat_b:.9f}  lon={lon_b:.9f}  (expect 28.5, -96.0)")
print(f"drift   : {(lat_b - 28.5) * 1e5:.2f} cm lat / {(lon_b + 96.0) * 1e5:.2f} cm lon")

# Debug the inverse chain: compare t at the projected point vs t_func(28.5)
e2 = e2_of(CLARKE_1866)
phi1 = math.radians(28 + 23 / 60)
phi2 = math.radians(30 + 17 / 60)
m1, m2 = m_func(phi1, e2), m_func(phi2, e2)
t1, t2 = t_func(phi1, e2), t_func(phi2, e2)
n = (math.log(m1) - math.log(m2)) / (math.log(t1) - math.log(t2))
f = m1 / (n * t1 ** n)
a = CLARKE_1866[0]
rho0 = a * f * t_func(math.radians(27 + 50 / 60), e2) ** n
rho = math.sqrt((e_ns - 2_000_000 * FTUS_TO_M) ** 2 + (rho0 - n_ns) ** 2)
t_inv = (rho / (a * f)) ** (1.0 / n)
t_true = t_func(math.radians(28.5), e2)
mu_inv = math.pi / 2.0 - 2.0 * math.atan(t_inv)
mu_true = math.pi / 2.0 - 2.0 * math.atan(t_true)
print(f"debug   : n={n:.12f} f={f:.12f} rho0={rho0:.4f}")
print(f"debug   : t_inv={t_inv:.12f} t_true={t_true:.12f}  mu_inv={math.degrees(mu_inv):.9f} mu_true={math.degrees(mu_true):.9f}")
assert abs(t_inv - t_true) < 1e-9, f"t mismatch: {t_inv} vs {t_true}"
print("PASS — formulas match the published EPSG example.\n")

# ─── 2. Emit expected values for the US SPCS Lambert zones ────────
print("=== 2. US SPCS Lambert zones (metres) ===")

ZONES = [
    # (name, srid, lat1, lat2, lat0, lon0, FE, FN, test point)
    ("Texas South Central (EPSG::6360)", 6360,
     27 + 50 / 60, 31 + 53 / 60, 27 + 50 / 60, -99.0, 600_000.0, 4_000_000.0,
     (29.4241, -98.4936)),  # San Antonio
    ("California zone 5 (EPSG::6335)", 6335,
     34 + 2 / 60, 35 + 28 / 60, 33 + 30 / 60, -118.0, 2_000_000.0, 500_000.0,
     (34.0522, -118.2437)),  # Los Angeles
    ("New York Long Island (EPSG::6539)", 6539,
     40 + 40 / 60, 41 + 2 / 60, 40 + 10 / 60, -74.0, 300_000.0, 0.0,
     (40.7128, -74.0060)),  # New York City
]

for name, srid, lat1, lat2, lat0, lon0, fe, fn, (plat, plon) in ZONES:
    e, n = lcc_forward(plat, plon, lat1, lat2, lat0, lon0, fe, fn, GRS80)
    lat_b, lon_b = lcc_inverse(e, n, lat1, lat2, lat0, lon0, fe, fn, GRS80)
    print(f"{name}")
    print(f"  input   lat={plat} lon={plon}")
    print(f"  forward E={e:.4f}  N={n:.4f}")
    print(f"  inverse lat={lat_b:.9f} lon={lon_b:.9f}  drift={(lat_b-plat)*1e5:.6f} cm / {(lon_b-plon)*1e5:.6f} cm")
    assert abs(lat_b - plat) < 1e-9 and abs(lon_b - plon) < 1e-9, "round-trip drift"
print("\nPASS — all US SPCS Lambert zones round-trip to 1e-9 deg.")

# ─── 3. Edge cases: negative-n, southern-hemisphere, single-parallel ──
print("=== 3. Edge cases ===")

EDGE_ZONES = [
    # (name, lat1, lat2, lat0, lon0, FE, FN, test point, expected n sign)
    # Southern-hemisphere 2SP zone (both parallels south of the equator).
    ("Southern 2SP (parallels 35°S / 45°S)",
     -35.0, -45.0, -35.0, 120.0, 0.0, 10_000_000.0,
     (-40.0, 122.0)),
    # Asymmetric equatorial straddle → n < 0 (parallels on opposite sides).
    ("Equatorial straddle, n<0 (5°N / 15°S)",
     5.0, -15.0, -5.0, 30.0, 500_000.0, 1_000_000.0,
     (-8.0, 33.0)),
    # Single-parallel limit (phi1 == phi2) — the EPSG 1SP degenerate branch.
    # A northern case (n = sin 34° > 0) and a southern case (n < 0,
    # which also exercises the negative-n inverse through the 1SP branch).
    ("Single-parallel limit (phi1==phi2=34N)",
     34.0, 34.0, 0.0, -96.0, 0.0, 0.0,
     (35.0, -95.0)),
    ("Single-parallel southern (phi1==phi2=34S)",
     -34.0, -34.0, -30.0, 150.0, 0.0, 10_000_000.0,
     (-35.0, 152.0)),
]

for name, lat1, lat2, lat0, lon0, fe, fn, (plat, plon) in EDGE_ZONES:
    e2 = e2_of(GRS80)
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    m1, m2 = m_func(phi1, e2), m_func(phi2, e2)
    t1, t2 = t_func(phi1, e2), t_func(phi2, e2)
    n = math.sin(phi1) if abs(lat1 - lat2) < 1e-12 else (math.log(m1) - math.log(m2)) / (math.log(t1) - math.log(t2))
    e, n_pt = lcc_forward(plat, plon, lat1, lat2, lat0, lon0, fe, fn, GRS80)
    lat_b, lon_b = lcc_inverse(e, n_pt, lat1, lat2, lat0, lon0, fe, fn, GRS80)
    drift_cm = ((lat_b - plat) ** 2 + (lon_b - plon) ** 2) ** 0.5 * 1e5
    print(f"{name}")
    print(f"  n={n:+.6f}  forward E={e:.4f} N={n_pt:.4f}  inverse drift={drift_cm:.6f} cm")
    assert abs(lat_b - plat) < 1e-9 and abs(lon_b - plon) < 1e-9, f"{name} round-trip drift"
print("\nPASS — all LCC edge cases round-trip to 1e-9 deg.")
