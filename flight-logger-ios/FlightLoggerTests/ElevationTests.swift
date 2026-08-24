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

    @MainActor
    func testAirportWithoutElevationIsNeverUsedAsTerrain() {
        let airports = AirportDatabase(airports: [
            Airport(code: "LKYY", name: "Bez elevace", latitude: 50.5, longitude: 15.5, elevation: nil)
        ])
        XCTAssertNil(airports.elevation(at: Coordinate(latitude: 50.5, longitude: 15.5)))
        // …but it still names the place.
        XCTAssertEqual(airports.nearest(to: Coordinate(latitude: 50.5, longitude: 15.5))?.airport.code, "LKYY")
    }

    @MainActor
    func testNearestAirportRespectsRadius() {
        let airports = AirportDatabase(airports: [
            Airport(code: "LKZZ", name: "Daleko", latitude: 50.0, longitude: 15.0, elevation: 300)
        ])
        XCTAssertNotNil(airports.nearest(to: Coordinate(latitude: 50.01, longitude: 15.0)))
        XCTAssertNil(airports.nearest(to: Coordinate(latitude: 51.0, longitude: 15.0)))
    }

    /// Bucketing must not lose airports that sit just across a degree boundary.
    @MainActor
    func testLookupWorksAcrossDegreeBoundaries() {
        let airports = AirportDatabase(airports: [
            Airport(code: "LKAA", name: "Na hranici", latitude: 49.999, longitude: 14.999, elevation: 400)
        ])
        let sample = airports.elevation(at: Coordinate(latitude: 50.001, longitude: 15.001))
        XCTAssertEqual(sample?.meters, 400)
    }

    // MARK: - Learned airfields

    /// The whole point: a strip that is in no dataset still gets named and,
    /// once the aircraft has stood on it, gets an elevation.
    @MainActor
    func testLearningAnAirfieldThatIsInNoDataset() {
        let db = AirportDatabase(airports: [])
        let strip = Coordinate(latitude: 50.7, longitude: 15.1)

        XCTAssertNil(db.nearest(to: strip))

        let learned = db.learn(at: strip, elevation: nil)
        XCTAssertTrue(learned.isLearned)
        XCTAssertNil(learned.elevation)
        XCTAssertEqual(db.nearest(to: strip)?.airport.id, learned.id)
        // No elevation yet, so it must not be offered as a terrain source.
        XCTAssertNil(db.elevation(at: strip))

        // Parked there with the recorder running.
        db.noteMeasuredElevation(412, at: GeoMath.offset(strip, north: 300, east: 0))
        XCTAssertEqual(db.elevation(at: strip)?.meters, 412)
        XCTAssertEqual(db.elevation(at: strip)?.source, .airport)
    }

    /// A takeoff and the landing that follows it at the same strip are one
    /// airfield, not two.
    @MainActor
    func testLearningTwiceAtTheSameFieldReusesTheEntry() {
        let db = AirportDatabase(airports: [])
        let strip = Coordinate(latitude: 50.7, longitude: 15.1)

        let first = db.learn(at: strip)
        let second = db.learn(at: GeoMath.offset(strip, north: 800, east: 200))
        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(db.learned.count, 1)

        // A field 20 km away is a different field.
        let elsewhere = db.learn(at: GeoMath.offset(strip, north: 20_000, east: 0))
        XCTAssertNotEqual(elsewhere.id, first.id)
        XCTAssertEqual(db.learned.count, 2)
    }

    @MainActor
    func testRenamingReportsTheOldCodeSoHistoryCanBeRelabelled() {
        let db = AirportDatabase(airports: [])
        let learned = db.learn(at: Coordinate(latitude: 50.7, longitude: 15.1))
        XCTAssertEqual(learned.code, "Plocha 1")

        let previous = db.rename(id: learned.id, code: "LKHN", name: "Hodkovice")
        XCTAssertEqual(previous, "Plocha 1")
        XCTAssertEqual(db.learned.first?.code, "LKHN")
        XCTAssertEqual(db.learned.first?.name, "Hodkovice")
        // Renaming to the same code is not a relabel.
        XCTAssertNil(db.rename(id: learned.id, code: "LKHN", name: "Hodkovice n. M."))
    }

    /// A handheld GPS does not get to overwrite a published field elevation.
    @MainActor
    func testMeasuredElevationNeverOverwritesTheDataset() {
        let db = AirportDatabase(airports: [
            Airport(code: "LKPR", name: "Praha", latitude: 50.1, longitude: 14.26, elevation: 380)
        ])
        db.noteMeasuredElevation(999, at: Coordinate(latitude: 50.1, longitude: 14.26))
        XCTAssertEqual(db.elevation(at: Coordinate(latitude: 50.1, longitude: 14.26))?.meters, 380)
        XCTAssertTrue(db.learned.isEmpty)
    }

    /// A named strip beside a dataset entry: the closer one wins, and a tie
    /// goes to the one the pilot named.
    @MainActor
    func testLearnedAirfieldWinsWhenItIsCloser() {
        let db = AirportDatabase(airports: [
            Airport(code: "LKXX", name: "Dataset", latitude: 50.10, longitude: 15.00, elevation: 300)
        ])
        db.add(code: "LKHN", name: "Hodkovice", coordinate: Coordinate(latitude: 50.11, longitude: 15.00), elevation: 420)

        let near = db.nearest(to: Coordinate(latitude: 50.109, longitude: 15.00))
        XCTAssertEqual(near?.airport.code, "LKHN")
        XCTAssertEqual(db.elevation(at: Coordinate(latitude: 50.109, longitude: 15.00))?.meters, 420)
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
