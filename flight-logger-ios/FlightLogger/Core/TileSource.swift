import Foundation

/// Where the map pictures come from.
///
/// One honest constraint shapes this whole feature. OpenStreetMap's own tile
/// servers are donated infrastructure, and their usage policy allows casual
/// browsing but **not** bulk downloading — which is exactly what filling an
/// offline region is. So the app browses on OSM and refuses to mass-download
/// from it, and offline regions need a source whose terms allow caching:
/// MapTiler, Thunderforest, Stadia and the like all have a free tier that
/// does, and a pilot running their own tile server obviously may.
///
/// The app therefore ships with no key and no bulk-capable default. The pilot
/// pastes a URL template they are entitled to use, and the app honours whatever
/// rate the provider asks for.
struct TileSource: Codable, Equatable, Sendable, Identifiable {

    var id: String
    var name: String

    /// An XYZ template, e.g. `https://example.org/{z}/{x}/{y}.png?key={key}`.
    /// `{z}`, `{x}`, `{y}` and `{key}` are substituted; nothing else is.
    var urlTemplate: String

    /// Shown on every map drawn from this source. Not optional — raster tile
    /// providers require it, and so does OSM-derived data whoever serves it.
    var attribution: String

    var minZoom: Int
    var maxZoom: Int

    /// What the provider is willing to be asked for, per second. The downloader
    /// never exceeds it.
    var requestsPerSecond: Double

    /// Whether this source's terms permit filling an offline region. False for
    /// OSM's public servers.
    var allowsBulkDownload: Bool

    var apiKey: String?

    func url(for tile: Tile) -> URL? {
        var text = urlTemplate
            .replacingOccurrences(of: "{z}", with: String(tile.z))
            .replacingOccurrences(of: "{x}", with: String(tile.x))
            .replacingOccurrences(of: "{y}", with: String(tile.y))
        text = text.replacingOccurrences(of: "{key}", with: apiKey ?? "")
        return URL(string: text)
    }

    func clampedZooms(_ zooms: ClosedRange<Int>) -> ClosedRange<Int> {
        let lower = max(minZoom, zooms.lowerBound)
        let upper = min(maxZoom, max(lower, zooms.upperBound))
        return lower...upper
    }

    // MARK: - Presets

    /// Browsing only. Downloading a region from here is refused — see the note
    /// at the top of this file.
    static let openStreetMap = TileSource(
        id: "osm",
        name: "OpenStreetMap",
        urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution: "© OpenStreetMap contributors",
        minZoom: 1,
        maxZoom: 18,
        requestsPerSecond: 2,
        allowsBulkDownload: false,
        apiKey: nil
    )

    /// The shape of a bring-your-own source, filled in by the pilot.
    static let customTemplate = TileSource(
        id: "custom",
        name: "Vlastní zdroj",
        urlTemplate: "",
        attribution: "",
        minZoom: 1,
        maxZoom: 16,
        requestsPerSecond: 4,
        allowsBulkDownload: true,
        apiKey: nil
    )

    var isUsable: Bool {
        guard !urlTemplate.isEmpty, urlTemplate.contains("{z}") else { return false }
        return urlTemplate.contains("{x}") && urlTemplate.contains("{y}")
    }
}

/// A piece of map kept on the phone.
struct OfflineRegion: Codable, Equatable, Identifiable, Sendable {

    var id: UUID = UUID()
    var name: String
    var center: Coordinate
    /// Metres. The tiles cover the square around this circle.
    var radius: Double
    var minZoom: Int
    var maxZoom: Int
    var sourceID: String

    var createdAt: Date = Date()
    /// Filled in as the download runs, so an interrupted region reports what it
    /// actually holds rather than what it meant to.
    var storedTiles: Int = 0
    var bytes: Int64 = 0
    var completedAt: Date?

    var zooms: ClosedRange<Int> { min(minZoom, maxZoom)...max(minZoom, maxZoom) }

    var expectedTiles: Int {
        TileMath.tileCount(center: center, radius: radius, zooms: zooms)
    }

    var isComplete: Bool { completedAt != nil }

    var progress: Double {
        let expected = expectedTiles
        guard expected > 0 else { return 0 }
        return min(1, Double(storedTiles) / Double(expected))
    }

    /// What a region will cost before it is downloaded. An average tile is
    /// around 18 kB; the real figure replaces this the moment anything lands
    /// on disk, because an estimate that never gets corrected is a lie.
    static let averageTileBytes = 18_000

    var estimatedBytes: Int64 { Int64(expectedTiles) * Int64(Self.averageTileBytes) }
}
