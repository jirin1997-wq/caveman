import XCTest
@testable import FlightLogger

@MainActor
final class TileStoreTests: XCTestCase {

    private var directory: URL!
    private let prague = Coordinate(latitude: 50.1008, longitude: 14.26)
    private let brno = Coordinate(latitude: 49.1513, longitude: 16.6944)

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("TileStoreTests-\(UUID().uuidString)")
        AppPaths.useDirectory(directory)
    }

    override func tearDown() {
        AppPaths.useDirectory(nil)
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    private func png(_ bytes: Int = 64) -> Data { Data(repeating: 0x89, count: bytes) }

    // MARK: - Files

    /// The layout is the one every XYZ server uses, so a cache can be seeded
    /// from a folder someone already has.
    func testTilesLandAtTheConventionalPath() {
        let store = TileStore()
        let tile = Tile(z: 12, x: 2210, y: 1387)
        XCTAssertTrue(store.url(for: tile).path.hasSuffix("tiles/12/2210/1387.png"))
    }

    func testStoreAndReadBack() {
        let store = TileStore()
        let tile = Tile(z: 12, x: 2210, y: 1387)

        XCTAssertFalse(store.has(tile))
        XCTAssertNil(store.data(for: tile))

        XCTAssertEqual(store.store(png(128), for: tile), 128)
        XCTAssertTrue(store.has(tile))
        XCTAssertEqual(store.data(for: tile)?.count, 128)
    }

    func testEmptyDataIsNotATile() {
        let store = TileStore()
        XCTAssertNil(store.store(Data(), for: Tile(z: 1, x: 0, y: 0)))
        XCTAssertFalse(store.has(Tile(z: 1, x: 0, y: 0)))
    }

    func testBytesOnDiskCountsWhatWasWritten() {
        let store = TileStore()
        for i in 0..<5 { store.store(png(100), for: Tile(z: 10, x: i, y: 7)) }
        store.recountBytes()
        XCTAssertEqual(store.bytesOnDisk, 500)
    }

    // MARK: - Regions

    func testRegionsSurviveAReload() {
        let store = TileStore()
        let region = OfflineRegion(name: "LKPR", center: prague, radius: 20_000,
                                   minZoom: 10, maxZoom: 12, sourceID: "custom")
        store.upsert(region)

        let reopened = TileStore()
        XCTAssertEqual(reopened.regions.count, 1)
        XCTAssertEqual(reopened.regions.first?.name, "LKPR")
        XCTAssertEqual(reopened.regions.first?.radius, 20_000)
    }

    func testUpsertReplacesRatherThanDuplicates() {
        let store = TileStore()
        var region = OfflineRegion(name: "LKPR", center: prague, radius: 20_000,
                                   minZoom: 10, maxZoom: 12, sourceID: "custom")
        store.upsert(region)
        region.storedTiles = 40
        region.completedAt = Date()
        store.upsert(region)

        XCTAssertEqual(store.regions.count, 1)
        XCTAssertTrue(store.regions[0].isComplete)
        XCTAssertEqual(store.regions[0].storedTiles, 40)
    }

    /// Two fields near each other share tiles. Deleting one region must not
    /// punch a hole in the other.
    func testDeletingARegionKeepsTilesAnotherStillWants() {
        let store = TileStore()
        let wide = OfflineRegion(name: "Široká", center: prague, radius: 30_000,
                                 minZoom: 11, maxZoom: 11, sourceID: "custom")
        let narrow = OfflineRegion(name: "Úzká", center: prague, radius: 5_000,
                                   minZoom: 11, maxZoom: 11, sourceID: "custom")
        store.upsert(wide)
        store.upsert(narrow)

        for tile in TileMath.tiles(center: prague, radius: 30_000, zooms: 11...11) {
            store.store(png(), for: tile)
        }

        let shared = TileMath.tiles(center: prague, radius: 5_000, zooms: 11...11)
        let wideOnly = Set(TileMath.tiles(center: prague, radius: 30_000, zooms: 11...11))
            .subtracting(shared)
        XCTAssertFalse(wideOnly.isEmpty, "the two regions must differ for this to mean anything")

        store.delete(wide)

        for tile in shared {
            XCTAssertTrue(store.has(tile), "tile \(tile) still belongs to the narrow region")
        }
        for tile in wideOnly {
            XCTAssertFalse(store.has(tile), "tile \(tile) belonged only to the region just deleted")
        }
        XCTAssertEqual(store.regions.map(\.name), ["Úzká"])
    }

    func testDeletingAnUnsharedRegionTakesItsTilesWithIt() {
        let store = TileStore()
        let region = OfflineRegion(name: "LKTB", center: brno, radius: 8_000,
                                   minZoom: 11, maxZoom: 11, sourceID: "custom")
        store.upsert(region)
        let tiles = TileMath.tiles(center: brno, radius: 8_000, zooms: 11...11)
        for tile in tiles { store.store(png(), for: tile) }

        store.delete(region)

        XCTAssertTrue(store.regions.isEmpty)
        for tile in tiles { XCTAssertFalse(store.has(tile)) }
        XCTAssertEqual(store.bytesOnDisk, 0)
    }

    func testDeleteAllClearsEverything() {
        let store = TileStore()
        store.upsert(OfflineRegion(name: "a", center: prague, radius: 5_000,
                                   minZoom: 11, maxZoom: 11, sourceID: "custom"))
        store.store(png(), for: Tile(z: 11, x: 1, y: 1))

        store.deleteAllTiles()

        XCTAssertTrue(store.regions.isEmpty)
        XCTAssertEqual(store.bytesOnDisk, 0)
        XCTAssertFalse(store.has(Tile(z: 11, x: 1, y: 1)))
    }
}

/// What the downloader refuses to even start, and why.
@MainActor
final class TileDownloadGuardTests: XCTestCase {

    private let prague = Coordinate(latitude: 50.1008, longitude: 14.26)

    private func region(radius: Double, zooms: ClosedRange<Int>) -> OfflineRegion {
        OfflineRegion(name: "test", center: prague, radius: radius,
                      minZoom: zooms.lowerBound, maxZoom: zooms.upperBound, sourceID: "custom")
    }

    private var good: TileSource {
        var source = TileSource.customTemplate
        source.urlTemplate = "https://example.org/{z}/{x}/{y}.png"
        return source
    }

    func testAnEmptyTemplateIsRefused() {
        XCTAssertEqual(
            TileDownloader.validate(region: region(radius: 10_000, zooms: 10...12),
                                    source: .customTemplate),
            .sourceUnusable
        )
    }

    /// OpenStreetMap's tiles are donated, and their policy does not allow
    /// bulk downloading. The app enforces that rather than leaving it to the
    /// pilot to know.
    func testOpenStreetMapIsRefusedForBulkDownload() {
        let failure = TileDownloader.validate(
            region: region(radius: 10_000, zooms: 10...12),
            source: .openStreetMap
        )
        XCTAssertEqual(failure, .bulkNotPermitted("OpenStreetMap"))
        XCTAssertTrue(failure?.errorDescription?.contains("vlastní zdroj") == true)
    }

    func testAnAbsurdRegionIsRefusedBeforeItStarts() {
        let huge = region(radius: 80_000, zooms: 6...16)
        guard case .tooManyTiles(let count, let limit)? = TileDownloader.validate(
            region: huge, source: good
        ) else {
            return XCTFail("a region of \(huge.expectedTiles) tiles should be refused")
        }
        XCTAssertEqual(count, huge.expectedTiles)
        XCTAssertEqual(limit, TileDownloader.tileLimit)
    }

    func testAReasonableRegionIsAccepted() {
        XCTAssertNil(
            TileDownloader.validate(region: region(radius: 30_000, zooms: 10...13), source: good)
        )
    }

    func testTheSourceClampsZoomsItDoesNotServe() {
        var source = good
        source.minZoom = 9
        source.maxZoom = 12
        XCTAssertEqual(source.clampedZooms(6...16), 9...12)
        XCTAssertEqual(source.clampedZooms(10...11), 10...11)
    }

    func testURLTemplateSubstitution() {
        var source = good
        source.urlTemplate = "https://example.org/{z}/{x}/{y}.png?key={key}"
        source.apiKey = "abc123"
        XCTAssertEqual(
            source.url(for: Tile(z: 12, x: 2210, y: 1387))?.absoluteString,
            "https://example.org/12/2210/1387.png?key=abc123"
        )
    }

    func testATemplateMissingItsPlaceholdersIsNotUsable() {
        var source = good
        source.urlTemplate = "https://example.org/map.png"
        XCTAssertFalse(source.isUsable)
        source.urlTemplate = "https://example.org/{z}/{x}.png"
        XCTAssertFalse(source.isUsable, "a template with no {y} addresses nothing")
    }
}
