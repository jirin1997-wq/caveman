"""Expected values for TileMathTests — computed, not guessed.

The slippy-map formulas are standard, but a test whose expected numbers came
out of the same head as the code proves nothing. These come from an
independent transcription, and the Swift test asserts against them.
"""
import math

LAT_LIMIT = 85.0511287798066


def tile_x(lon, z):
    n = 2 ** z
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    return x % n


def tile_y(lat, z):
    lat = max(-LAT_LIMIT, min(LAT_LIMIT, lat))
    n = 2 ** z
    r = math.radians(lat)
    y = int(math.floor((1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n))
    return max(0, min(n - 1, y))


def ground_resolution(lat, z):
    """Metres per pixel, 256 px tiles."""
    return math.cos(math.radians(lat)) * 2 * math.pi * 6378137 / (256 * 2 ** z)


def tile_span(lat, z):
    return ground_resolution(lat, z) * 256


def tile_range(lat, lon, radius_m, z):
    d_lat = radius_m / 111_320.0
    d_lon = radius_m / (111_320.0 * math.cos(math.radians(lat)))
    x0, x1 = tile_x(lon - d_lon, z), tile_x(lon + d_lon, z)
    # north is the smaller y
    y0, y1 = tile_y(lat + d_lat, z), tile_y(lat - d_lat, z)
    return (x0, x1), (y0, y1)


def tile_count(lat, lon, radius_m, zooms):
    total = 0
    for z in zooms:
        (x0, x1), (y0, y1) = tile_range(lat, lon, radius_m, z)
        total += (x1 - x0 + 1) * (y1 - y0 + 1)
    return total


if __name__ == "__main__":
    LKPR = (50.1008, 14.26)
    print("zoom 0, anywhere          ", tile_x(14.26, 0), tile_y(50.1, 0))
    print("null island, zoom 1       ", tile_x(0, 1), tile_y(0, 1))
    print("LKPR zoom 12              ", tile_x(LKPR[1], 12), tile_y(LKPR[0], 12))
    print("LKPR zoom 14              ", tile_x(LKPR[1], 14), tile_y(LKPR[0], 14))
    print()
    for z in (10, 11, 12, 13, 14):
        print(f"zoom {z}: {tile_span(LKPR[0], z):8.0f} m/dlaždice   "
              f"{ground_resolution(LKPR[0], z):6.2f} m/px")
    print()
    for r in (10_000, 30_000, 50_000):
        n = tile_count(LKPR[0], LKPR[1], r, range(10, 14))
        print(f"okruh {r//1000:3d} km, zoom 10-13: {n:6d} dlaždic  ~{n * 18 / 1024:7.1f} MB")
    print()
    (x0, x1), (y0, y1) = tile_range(LKPR[0], LKPR[1], 30_000, 12)
    print(f"LKPR 30 km, zoom 12: x {x0}..{x1}  y {y0}..{y1}")
