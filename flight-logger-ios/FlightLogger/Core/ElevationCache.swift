import Foundation

/// Disk-backed grid of terrain elevations.
///
/// Terrain does not change, so an answer fetched once is good forever. The grid
/// is ~0.005° (roughly 550 m of latitude); anything finer would blow up the
/// cache without helping, since the whole point of AGL here is "am I 40 m up or
/// 400 m up", not survey accuracy.
final class ElevationCache {

    static let filename = "elevation-cache.json"
    /// Grid step in degrees.
    static let step = 0.005

    private var tiles: [String: Double] = [:]
    private var dirty = false
    private let url: URL?

    init(directory: URL?) {
        self.url = directory?.appendingPathComponent(Self.filename)
        guard let url, let data = try? Data(contentsOf: url) else { return }
        tiles = (try? JSONDecoder().decode([String: Double].self, from: data)) ?? [:]
    }

    static func key(_ c: Coordinate) -> String {
        let lat = (c.latitude / step).rounded()
        let lon = (c.longitude / step).rounded()
        return "\(Int(lat)):\(Int(lon))"
    }

    func elevation(at c: Coordinate) -> ElevationSample? {
        guard let meters = tiles[Self.key(c)] else { return nil }
        return ElevationSample(meters: meters, source: .cache)
    }

    func store(_ meters: Double, at c: Coordinate) {
        tiles[Self.key(c)] = meters
        dirty = true
    }

    var count: Int { tiles.count }

    /// Best-effort write. A cache that fails to persist costs one extra network
    /// round trip later; it must never surface as an error to the pilot.
    func flush() {
        guard dirty, let url else { return }
        dirty = false
        guard let data = try? JSONEncoder().encode(tiles) else { return }
        try? data.write(to: url, options: .atomic)
    }

    func clear() {
        tiles.removeAll()
        dirty = true
        flush()
    }
}
