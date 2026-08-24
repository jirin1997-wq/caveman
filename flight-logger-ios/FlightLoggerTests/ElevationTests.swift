import XCTest
@testable import FlightLogger

final class ElevationTests: XCTestCase {

    private let field = Coordinate(latitude: 49.9, longitude: 15.0)

    // MARK: - Ground reference

    @MainActor
    func testGroundReferenceNeedsEnoughStationarySamples() {
        let provider = makeProvider()
        let start = Date(timeIntervalSince1970: 1_700_000_000)

        // Three samples over three seconds is not a reference.
        for i in 0..<3 {
            provider.noteGroundSample(fix(at: start.addingTimeInterval(Double(i)), altitude: 250))
        }
        XCTAssertNil(provider.groundReference)

        for i in 3..<15 {
            provider.noteGroundSample(fix(at: start.addingTimeInterval(Double(i)), altitude: 250))
        }
        XCTAssertEqual(provider.groundReference?.meters, 250)
    }

    /// One wild altitude spike — GPS does this — must not move the reference.
    @MainActor
    func testGroundReferenceIsMedianNotMean() {
        let provider = makeProvider()
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var altitudes = Array(repeating: 250.0, count: 14)
        altitudes.append(9_000)

        for (i, altitude) in altitudes.enumerated() {
            provider.noteGroundSample(fix(at: start.addingTimeInterval(Double(i)), altitude: altitude))
        }
        XCTAssertEqual(provider.groundReference?.meters, 250)
    }

    @MainActor
    func testReferenceIsUsedNearTheFieldAndDroppedFarAway() {
        let provider = makeProvider()
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        for i in 0..<15 {
            provider.noteGroundSample(fix(at: start.addingTimeInterval(Double(i)), altitude: 250))
        }

        let near = provider.bestEffort(at: GeoMath.offset(field, north: 500, east: 0), now: start)
        XCTAssertEqual(near?.source, .groundReference)

        // 60 km away the departure elevation says nothing about the terrain.
        let far = provider.bestEffort(at: GeoMath.offset(field, north: 60_000, east: 0), now: start)
        XCTAssertNil(far)
    }

    @MainActor
    func testStaleReferenceIsIgnored() {
        let provider = makeProvider()
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        for i in 0..<15 {
            provider.noteGroundSample(fix(at: start.addingTimeInterval(Double(i)), altitude: 250))
        }
        let nextDay = start.addingTimeInterval(36 * 3600)
        XCTAssertNil(provider.bestEffort(at: field, now: nextDay))
    }

    // MARK: - Airport database

    @MainActor
    func testAirportElevationWinsWhenAwayFromTheReference() {
        let airports = AirportDatabase(airports: [
            Airport(code: "LKXX", name: "Test", latitude: 50.5, longitude: 15.5, elevation: 600)
        ])
        let provider = CombinedElevationProvider(airports: airports, cache: ElevationCache(directory: nil))
        let sample = provider.bestEffort(at: Coordinate(latitude: 50.502, longitude: 15.503))
        XCTAssertEqual(sample?.source, .airport)
        XCTAssertEqual(sample?.meters, 600)
    }

    func testAirportWithoutElevationIsNeverUsedAsTerrain() {
        let airports = AirportDatabase(airports: [
            Airport(code: "LKYY", name: "Bez elevace", latitude: 50.5, longitude: 15.5, elevation: nil)
        ])
        XCTAssertNil(airports.elevation(at: Coordinate(latitude: 50.5, longitude: 15.5)))
        // …but it still names the place.
        XCTAssertEqual(airports.nearest(to: Coordinate(latitude: 50.5, longitude: 15.5))?.airport.code, "LKYY")
    }

    func testNearestAirportRespectsRadius() {
        let airports = AirportDatabase(airports: [
            Airport(code: "LKZZ", name: "Daleko", latitude: 50.0, longitude: 15.0, elevation: 300)
        ])
        XCTAssertNotNil(airports.nearest(to: Coordinate(latitude: 50.01, longitude: 15.0)))
        XCTAssertNil(airports.nearest(to: Coordinate(latitude: 51.0, longitude: 15.0)))
    }

    /// Bucketing must not lose airports that sit just across a degree boundary.
    func testLookupWorksAcrossDegreeBoundaries() {
        let airports = AirportDatabase(airports: [
            Airport(code: "LKAA", name: "Na hranici", latitude: 49.999, longitude: 14.999, elevation: 400)
        ])
        let sample = airports.elevation(at: Coordinate(latitude: 50.001, longitude: 15.001))
        XCTAssertEqual(sample?.meters, 400)
    }

    // MARK: - Cache

    func testCacheRoundTripsWithinAGridSquare() {
        let cache = ElevationCache(directory: nil)
        cache.store(512, at: Coordinate(latitude: 49.9000, longitude: 15.0000))
        // 200 m away — same grid square.
        XCTAssertEqual(cache.elevation(at: Coordinate(latitude: 49.9015, longitude: 15.0))?.meters, 512)
        // 5 km away — different square, no answer invented.
        XCTAssertNil(cache.elevation(at: Coordinate(latitude: 49.95, longitude: 15.0)))
    }

    // MARK: - Helpers

    @MainActor
    private func makeProvider() -> CombinedElevationProvider {
        CombinedElevationProvider(
            airports: AirportDatabase(airports: []),
            cache: ElevationCache(directory: nil)
        )
    }

    private func fix(at time: Date, altitude: Double) -> Fix {
        Fix(
            timestamp: time,
            latitude: field.latitude,
            longitude: field.longitude,
            altitude: altitude,
            speed: 0,
            course: -1,
            horizontalAccuracy: 5,
            verticalAccuracy: 8
        )
    }
}
