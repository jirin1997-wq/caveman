import XCTest
@testable import FlightLogger

/// Bearings and the nearest-field list the EMER and DIRECT keys are built on.
@MainActor
final class NavigationTests: XCTestCase {

    private let origin = Coordinate(latitude: 0, longitude: 0)

    // MARK: - Bearing

    /// On the equator the cardinal directions are exact.
    func testCardinalBearingsOnTheEquator() {
        XCTAssertEqual(GeoMath.bearing(from: origin, to: Coordinate(latitude: 1, longitude: 0)), 0, accuracy: 0.01)
        XCTAssertEqual(GeoMath.bearing(from: origin, to: Coordinate(latitude: 0, longitude: 1)), 90, accuracy: 0.01)
        XCTAssertEqual(GeoMath.bearing(from: origin, to: Coordinate(latitude: -1, longitude: 0)), 180, accuracy: 0.01)
        XCTAssertEqual(GeoMath.bearing(from: origin, to: Coordinate(latitude: 0, longitude: -1)), 270, accuracy: 0.01)
    }

    /// Always in [0, 360), never negative — the DIRECT bearing is shown as-is.
    func testBearingIsNormalisedToZeroToThreeSixty() {
        let west = GeoMath.bearing(from: origin, to: Coordinate(latitude: 0.1, longitude: -0.1))
        XCTAssertGreaterThanOrEqual(west, 0)
        XCTAssertLessThan(west, 360)
        XCTAssertEqual(west, 315, accuracy: 0.5)
    }

    /// A field due north of the aircraft should read about 0° from there, and
    /// the way back should read about 180°.
    func testReverseBearingDiffersByAboutHalfTurn() {
        let a = Coordinate(latitude: 49.9, longitude: 15.0)
        let b = Coordinate(latitude: 50.1, longitude: 15.0)
        let forward = GeoMath.bearing(from: a, to: b)
        let back = GeoMath.bearing(from: b, to: a)
        XCTAssertEqual(abs(forward - back), 180, accuracy: 0.5)
        XCTAssertLessThan(min(forward, 360 - forward), 1, "due north is about 0°")
    }

    // MARK: - Nearest fields

    private func airfield(_ code: String, _ lat: Double, _ lon: Double) -> Airport {
        Airport(code: code, name: "Field \(code)", latitude: lat, longitude: lon)
    }

    func testNearbyListIsSortedNearestFirst() {
        let db = AirportDatabase(airports: [
            airfield("FAR", 50.6, 14.0),    // ~67 km
            airfield("NEAR", 50.0, 14.0),   // here
            airfield("MID", 50.2, 14.0),    // ~22 km
        ])
        let list = db.nearbyList(to: Coordinate(latitude: 50.0, longitude: 14.0), limit: 10)
        XCTAssertEqual(list.map(\.airport.code), ["NEAR", "MID", "FAR"])
        XCTAssertLessThan(list[0].distance, list[1].distance)
    }

    func testNearbyListRespectsTheLimit() {
        let db = AirportDatabase(airports: [
            airfield("A", 50.0, 14.0), airfield("B", 50.1, 14.0), airfield("C", 50.2, 14.0),
        ])
        let list = db.nearbyList(to: Coordinate(latitude: 50.0, longitude: 14.0), limit: 2)
        XCTAssertEqual(list.map(\.airport.code), ["A", "B"])
    }

    /// The index only guarantees about 70 km east-west, so a field further out
    /// than the cap must not appear, however close the bucket looks.
    func testNearbyListDropsFieldsBeyondTheCap() {
        let db = AirportDatabase(airports: [
            airfield("NEAR", 50.0, 14.0),
            airfield("FAR", 52.0, 14.0),    // ~222 km
        ])
        let list = db.nearbyList(to: Coordinate(latitude: 50.0, longitude: 14.0), limit: 10)
        XCTAssertEqual(list.map(\.airport.code), ["NEAR"])
    }

    /// A field the pilot learned is part of the list too, not only the dataset.
    func testLearnedFieldsAreIncluded() {
        let learned = airfield("LKHN", 50.05, 14.0)
        let db = AirportDatabase(learned: [learned])
        let list = db.nearbyList(to: Coordinate(latitude: 50.0, longitude: 14.0), limit: 5)
        XCTAssertEqual(list.map(\.airport.code), ["LKHN"])
    }
}

/// The language switch: what a string resolves to once the setting is applied.
@MainActor
final class LocalizationTests: XCTestCase {

    override func tearDown() {
        L10n.active = .cs
        super.tearDown()
    }

    func testCzechIsTheDefaultAndReturnsTheSourceText() {
        L10n.active = .cs
        XCTAssertEqual(L10n.t("Záznam"), "Záznam")
    }

    func testEnglishReturnsTheTranslation() {
        L10n.active = .en
        XCTAssertEqual(L10n.t("Záznam"), "REC")
        XCTAssertEqual(L10n.t("Zastavit"), "STOP")
    }

    /// A string with no entry must not break: it degrades to the Czech.
    func testAMissingEntryFallsBackToCzech() {
        L10n.active = .en
        XCTAssertEqual(L10n.t("text, který v tabulce není"), "text, který v tabulce není")
    }

    func testExplicitSettingsResolveDirectly() {
        XCTAssertEqual(L10n.resolve(.czech), .cs)
        XCTAssertEqual(L10n.resolve(.english), .en)
    }
}
