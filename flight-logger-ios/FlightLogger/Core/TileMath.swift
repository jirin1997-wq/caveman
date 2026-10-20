import Foundation

/// Slippy-map tile arithmetic: the Web Mercator grid every XYZ raster tile
/// server uses.
///
/// The world is one tile at zoom 0 and splits in four at every level, so a
/// tile is addressed by `z/x/y` with y counted from the north. Latitude is
/// clamped to ±85.0511°, where the Mercator projection runs off to infinity —
/// no aircraft this app cares about flies there, but the formula has to stay
/// finite anyway.
enum TileMath {

    /// Where Mercator gives up. Past this the projection's y goes to infinity.
    static let latitudeLimit = 85.0511287798066

    static let tileSize = 256
    static let earthRadius = 6_378_137.0
    static let metresPerDegreeLatitude = 111_320.0

    static func tilesPerSide(zoom: Int) -> Int { 1 << max(0, zoom) }

    static func x(longitude: Double, zoom: Int) -> Int {
        let n = tilesPerSide(zoom: zoom)
        let raw = Int(floor((longitude + 180) / 360 * Double(n)))
        // Longitude wraps; a region straddling the antimeridian still has to
        // name tiles that exist.
        return ((raw % n) + n) % n
    }

    static func y(latitude: Double, zoom: Int) -> Int {
        let n = tilesPerSide(zoom: zoom)
        let clamped = min(latitudeLimit, max(-latitudeLimit, latitude))
        let radians = clamped * .pi / 180
        let projected = log(tan(radians) + 1 / cos(radians))
        let raw = Int(floor((1 - projected / .pi) / 2 * Double(n)))
        return min(n - 1, max(0, raw))
    }

    /// Metres on the ground per screen pixel — what decides whether a zoom is
    /// worth downloading. At 50° north, zoom 13 is about 12 m per pixel, which
    /// resolves a runway; zoom 10 is 98 m, which resolves a town.
    static func groundResolution(latitude: Double, zoom: Int) -> Double {
        let clamped = min(latitudeLimit, max(-latitudeLimit, latitude))
        return cos(clamped * .pi / 180) * 2 * .pi * earthRadius
            / Double(tileSize * tilesPerSide(zoom: zoom))
    }

    /// How much ground one tile covers, in metres.
    static func tileSpan(latitude: Double, zoom: Int) -> Double {
        groundResolution(latitude: latitude, zoom: zoom) * Double(tileSize)
    }

    /// The x and y tile ranges covering a circle of `radius` metres.
    ///
    /// A square of tiles around a circle, which is what every offline map does:
    /// the corners reach about 40% further than the radius asked for, and that
    /// is the cheap side of the trade.
    static func range(
        center: Coordinate,
        radius: Double,
        zoom: Int
    ) -> (x: ClosedRange<Int>, y: ClosedRange<Int>) {
        let dLat = radius / metresPerDegreeLatitude
        let cosLat = max(0.01, cos(center.latitude * .pi / 180))
        let dLon = radius / (metresPerDegreeLatitude * cosLat)

        let x0 = x(longitude: center.longitude - dLon, zoom: zoom)
        let x1 = x(longitude: center.longitude + dLon, zoom: zoom)
        // North is the smaller y, so the ranges swap.
        let y0 = y(latitude: center.latitude + dLat, zoom: zoom)
        let y1 = y(latitude: center.latitude - dLat, zoom: zoom)

        return (min(x0, x1)...max(x0, x1), min(y0, y1)...max(y0, y1))
    }

    static func tileCount(center: Coordinate, radius: Double, zoom: Int) -> Int {
        let r = range(center: center, radius: radius, zoom: zoom)
        return r.x.count * r.y.count
    }

    static func tileCount(center: Coordinate, radius: Double, zooms: ClosedRange<Int>) -> Int {
        zooms.reduce(0) { $0 + tileCount(center: center, radius: radius, zoom: $1) }
    }

    /// Every tile in a region, north-west first, so a download that is watched
    /// fills in from the corner rather than scattering.
    static func tiles(center: Coordinate, radius: Double, zooms: ClosedRange<Int>) -> [Tile] {
        var out: [Tile] = []
        out.reserveCapacity(tileCount(center: center, radius: radius, zooms: zooms))
        for zoom in zooms {
            let r = range(center: center, radius: radius, zoom: zoom)
            for ty in r.y {
                for tx in r.x {
                    out.append(Tile(z: zoom, x: tx, y: ty))
                }
            }
        }
        return out
    }

    /// The coordinate at a tile's north-west corner — what a renderer needs to
    /// place the image.
    static func northWest(of tile: Tile) -> Coordinate {
        let n = Double(tilesPerSide(zoom: tile.z))
        let lon = Double(tile.x) / n * 360 - 180
        let yy = .pi - 2 * .pi * Double(tile.y) / n
        let lat = 180 / .pi * atan(0.5 * (exp(yy) - exp(-yy)))
        return Coordinate(latitude: lat, longitude: lon)
    }
}

/// One tile's address.
struct Tile: Hashable, Codable, Sendable, CustomStringConvertible {
    var z: Int
    var x: Int
    var y: Int

    var description: String { "\(z)/\(x)/\(y)" }

    /// The path a tile takes on disk and in a URL template, in that order.
    var path: String { "\(z)/\(x)/\(y)" }
}
