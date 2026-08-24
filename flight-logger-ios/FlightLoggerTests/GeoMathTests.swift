import XCTest
@testable import FlightLogger

final class GeoMathTests: XCTestCase {

    func testDistanceAgainstAKnownPair() {
        // Praha ~ Brno, roughly 185 km.
        let praha = Coordinate(latitude: 50.0755, longitude: 14.4378)
        let brno = Coordinate(latitude: 49.1951, longitude: 16.6068)
        let d = GeoMath.distance(praha, brno)
        XCTAssertEqual(d / 1000, 185, accuracy: 5)
    }

    func testOffsetIsSelfConsistent() {
        let origin = Coordinate(latitude: 49.9, longitude: 15.0)
        let moved = GeoMath.offset(origin, north: 1_000, east: 0)
        XCTAssertEqual(GeoMath.distance(origin, moved), 1_000, accuracy: 5)
    }

    func testSlopeRecoversAKnownClimbRate() {
        let x = (0..<10).map { Double($0) }
        let y = x.map { 250 + 3.5 * $0 }
        XCTAssertEqual(GeoMath.slope(x: x, y: y) ?? 0, 3.5, accuracy: 0.001)
    }

    func testSlopeRejectsDegenerateInput() {
        XCTAssertNil(GeoMath.slope(x: [1], y: [1]))
        XCTAssertNil(GeoMath.slope(x: [2, 2, 2], y: [1, 2, 3]))
    }

    func testMedian() {
        XCTAssertEqual(GeoMath.median([3, 1, 2]), 2)
        XCTAssertEqual(GeoMath.median([4, 1, 3, 2]), 2.5)
        XCTAssertNil(GeoMath.median([]))
    }

    func testUnitConversionsRoundTrip() {
        XCTAssertEqual(Units.metersToFeet(Units.feetToMeters(1_000)), 1_000, accuracy: 0.001)
        XCTAssertEqual(Units.mpsToKnots(Units.knotsToMps(60)), 60, accuracy: 0.001)
        XCTAssertEqual(Units.mpsToFpm(5.08), 1_000, accuracy: 1)
    }
}
