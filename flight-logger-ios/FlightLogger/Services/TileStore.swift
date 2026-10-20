import Foundation

/// Map tiles on disk, and the regions that put them there.
///
/// Tiles live at `tiles/z/x/y.png`, the same layout every XYZ server uses, so
/// the cache can be inspected — or seeded from a folder someone already has —
/// without the app needing to explain its own format.
@MainActor
final class TileStore: ObservableObject {

    @Published private(set) var regions: [OfflineRegion] = []
    /// Bytes on disk. Recounted after a download and on demand, not on every
    /// tile — walking the tree for each of several hundred writes would cost
    /// more than the download.
    @Published private(set) var bytesOnDisk: Int64 = 0

    private var manifestURL: URL { AppPaths.root.appendingPathComponent("tile-regions.json") }

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init() {
        load()
        recountBytes()
    }

    // MARK: - Tiles

    /// The files themselves are reached through a value that belongs to no
    /// actor, because MapKit asks for tiles on whatever thread it likes.
    let files = TileFiles()

    func url(for tile: Tile) -> URL { files.url(for: tile) }
    func has(_ tile: Tile) -> Bool { files.has(tile) }
    func data(for tile: Tile) -> Data? { files.data(for: tile) }

    @discardableResult
    func store(_ data: Data, for tile: Tile) -> Int? { files.store(data, for: tile) }

    // MARK: - Regions

    func load() {
        guard let blob = try? Data(contentsOf: manifestURL) else { return }
        regions = (try? decoder.decode([OfflineRegion].self, from: blob)) ?? []
        regions.sort { $0.createdAt > $1.createdAt }
    }

    func save() {
        guard let blob = try? encoder.encode(regions) else { return }
        try? blob.write(to: manifestURL, options: .atomic)
    }

    func upsert(_ region: OfflineRegion) {
        if let index = regions.firstIndex(where: { $0.id == region.id }) {
            regions[index] = region
        } else {
            regions.append(region)
        }
        regions.sort { $0.createdAt > $1.createdAt }
        save()
    }

    /// Forgets a region and deletes the tiles no other region still wants.
    ///
    /// Two regions around neighbouring fields overlap, and deleting one must
    /// not punch a hole in the other. So the tiles to remove are this region's
    /// set minus the union of everything that remains.
    func delete(_ region: OfflineRegion) {
        regions.removeAll { $0.id == region.id }
        save()

        var keep = Set<Tile>()
        for other in regions {
            keep.formUnion(TileMath.tiles(center: other.center, radius: other.radius, zooms: other.zooms))
        }
        for tile in TileMath.tiles(center: region.center, radius: region.radius, zooms: region.zooms)
        where !keep.contains(tile) {
            try? FileManager.default.removeItem(at: url(for: tile))
        }
        recountBytes()
    }

    func deleteAllTiles() {
        try? FileManager.default.removeItem(at: AppPaths.tiles)
        regions.removeAll()
        save()
        recountBytes()
    }

    // MARK: - Size

    func recountBytes() {
        bytesOnDisk = Self.directorySize(AppPaths.tiles)
    }

    nonisolated static func directorySize(_ directory: URL) -> Int64 {
        guard let walker = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return 0 }

        var total: Int64 = 0
        for case let url as URL in walker {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            total += Int64(size)
        }
        return total
    }
}


/// Reading and writing tile files, from any thread.
///
/// MapKit calls `loadTile` on a queue of its own choosing, so the part of the
/// cache it touches cannot be isolated to the main actor. There is no mutable
/// state here — only paths — so being free of an actor costs nothing.
struct TileFiles: Sendable {

    func url(for tile: Tile) -> URL {
        AppPaths.tiles
            .appendingPathComponent("\(tile.z)", isDirectory: true)
            .appendingPathComponent("\(tile.x)", isDirectory: true)
            .appendingPathComponent("\(tile.y).png")
    }

    func has(_ tile: Tile) -> Bool {
        FileManager.default.fileExists(atPath: url(for: tile).path)
    }

    func data(for tile: Tile) -> Data? {
        try? Data(contentsOf: url(for: tile))
    }

    /// Returns the bytes written, or nil when the write failed.
    @discardableResult
    func store(_ data: Data, for tile: Tile) -> Int? {
        guard !data.isEmpty else { return nil }
        let target = url(for: tile)
        let directory = target.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: directory.path) {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        do {
            try data.write(to: target, options: .atomic)
            return data.count
        } catch {
            return nil
        }
    }
}
