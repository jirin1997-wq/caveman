import XCTest
@testable import FlightLogger

/// The expected numbers come from `tools/tile-reference.py`, an independent
/// transcription of the slippy-map formulas. A test whose answers came out of
/// the same head as the code proves only that the head was consistent.
final class TileMathTests: XCTestCase {

    private let prague = Coordinate(latitude: 50.1008, longitude: 14.26)

    // MARK: - Addressing

    func testTheWholeWorldIsOneTileAtZoomZero() {
        XCTAssertEqual(TileMath.x(longitude: 14.26, zoom: 0), 0)
        XCTAssertEqual(TileMath.y(latitude: 50.1, zoom: 0), 0)
        XCTAssertEqual(TileMath.x(longitude: -179, zoom: 0), 0)
        XCTAssertEqual(TileMath.y(latitude: -60, zoom: 0), 0)
    }

    func testNullIslandSitsOnTheCornerOfAllFourTilesAtZoomOne() {
        XCTAssertEqual(TileMath.x(longitude: 0, zoom: 1), 1)
        XCTAssertEqual(TileMath.y(latitude: 0, zoom: 1), 1)
    }

    func testKnownAirfieldLandsOnKnownTiles() {
        XCTAssertEqual(TileMath.x(longitude: prague.longitude, zoom: 12), 2210)
        XCTAssertEqual(TileMath.y(latitude: prague.latitude, zoom: 12), 1387)
        XCTAssertEqual(TileMath.x(longitude: prague.longitude, zoom: 14), 8840)
        XCTAssertEqual(TileMath.y(latitude: prague.latitude, zoom: 14), 5549)
    }

    /// Mercator runs off to infinity at the poles. The formula has to stay
    /// finite and inside the grid anyway.
    func testThePolesStayInsideTheGrid() {
        for zoom in [1, 8, 14] {
            let n = TileMath.tilesPerSide(zoom: zoom)
            XCTAssertEqual(TileMath.y(latitude: 90, zoom: zoom), 0)
            XCTAssertEqual(TileMath.y(latitude: -90, zoom: zoom), n - 1)
            XCTAssertTrue((0..<n).contains(TileMath.y(latitude: 89.999, zoom: zoom)))
        }
    }

    func testLongitudeWrapsRatherThanRunningOffTheEdge() {
        let n = TileMath.tilesPerSide(zoom: 10)
        XCTAssertEqual(TileMath.x(longitude: 180, zoom: 10), 0, "180° wraps to the first column")
        XCTAssertEqual(TileMath.x(longitude: -180, zoom: 10), 0)
        XCTAssertTrue((0..<n).contains(TileMath.x(longitude: 400, zoom: 10)))
        XCTAssertTrue((0..<n).contains(TileMath.x(longitude: -400, zoom: 10)))
    }

    /// A tile's own north-west corner must address that same tile again.
    func testCornersRoundTrip() {
        for zoom in [4, 10, 13] {
            for tile in [Tile(z: zoom, x: 3, y: 5), Tile(z: zoom, x: 0, y: 0)] {
                let corner = TileMath.northWest(of: tile)
                XCTAssertEqual(TileMath.x(longitude: corner.longitude, zoom: zoom), tile.x)
                XCTAssertEqual(TileMath.y(latitude: corner.latitude, zoom: zoom), tile.y)
            }
        }
    }

    // MARK: - Scale

    func testResolutionIsWhatTheZoomLevelPromises() {
        // ~24.5 m per pixel at zoom 12 at this latitude; halves each level.
        XCTAssertEqual(TileMath.groundResolution(latitude: prague.latitude, zoom: 12), 24.51, accuracy: 0.05)
        XCTAssertEqual(TileMath.groundResolution(latitude: prague.latitude, zoom: 13), 12.26, accuracy: 0.05)
        XCTAssertEqual(TileMath.tileSpan(latitude: prague.latitude, zoom: 12), 6276, accuracy: 5)
    }

    // MARK: - Regions

    func testRegionCoversTheExpectedTiles() {
        let r = TileMath.range(center: prague, radius: 30_000, zoom: 12)
        XCTAssertEqual(r.x, 2205...2215)
        XCTAssertEqual(r.y, 1382...1392)
    }

    func testRegionAlwaysContainsItsOwnCentre() {
        for radius in [500.0, 5_000, 50_000] {
            for zoom in [8, 11, 14] {
                let r = TileMath.range(center: prague, radius: radius, zoom: zoom)
                XCTAssertTrue(r.x.contains(TileMath.x(longitude: prague.longitude, zoom: zoom)))
                XCTAssertTrue(r.y.contains(TileMath.y(latitude: prague.latitude, zoom: zoom)))
            }
        }
    }

    func testTileCountMatchesTheReference() {
        XCTAssertEqual(TileMath.tileCount(center: prague, radius: 30_000, zooms: 10...13), 589)
        XCTAssertEqual(TileMath.tileCount(center: prague, radius: 10_000, zooms: 10...13), 73)
        XCTAssertEqual(TileMath.tileCount(center: prague, radius: 50_000, zooms: 10...13), 1484)
    }

    /// Every zoom level quarters the tile, so a region costs roughly four times
    /// as much for each one added. This is the number that decides whether an
    /// offline map is 10 MB or 400.
    func testOneMoreZoomLevelCostsAboutFourTimesAsMuch() {
        let twelve = TileMath.tileCount(center: prague, radius: 40_000, zoom: 12)
        let thirteen = TileMath.tileCount(center: prague, radius: 40_000, zoom: 13)
        XCTAssertEqual(Double(thirteen) / Double(twelve), 4, accuracy: 0.6)
    }

    func testTilesAreEnumeratedExactlyOnce() {
        let tiles = TileMath.tiles(center: prague, radius: 20_000, zooms: 11...13)
        XCTAssertEqual(tiles.count, TileMath.tileCount(center: prague, radius: 20_000, zooms: 11...13))
        XCTAssertEqual(Set(tiles).count, tiles.count, "a tile downloaded twice is a tile paid for twice")
    }

    func testEstimateScalesWithTheRegion() {
        let small = OfflineRegion(name: "a", center: prague, radius: 10_000,
                                  minZoom: 10, maxZoom: 13, sourceID: "custom")
        let large = OfflineRegion(name: "b", center: prague, radius: 50_000,
                                  minZoom: 10, maxZoom: 13, sourceID: "custom")
        XCTAssertEqual(small.expectedTiles, 73)
        XCTAssertGreaterThan(large.estimatedBytes, small.estimatedBytes * 10)
        XCTAssertEqual(small.progress, 0)
        XCTAssertFalse(small.isComplete)
    }
}
