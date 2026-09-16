import XCTest
@testable import FlightLogger

final class MotionFusionTests: XCTestCase {

    private let field = Coordinate(latitude: 49.9, longitude: 15.0)
    private let start = Date(timeIntervalSince1970: 1_700_000_000)

    // MARK: - Barometric reference

    func testReferenceNeedsSeveralReadingsAndIsAMedian() {
        var reference = BaroReference()
        reference.noteGroundReading(1.0, at: start)
        XCTAssertNil(reference.zero)

        for i in 1...6 { reference.noteGroundReading(1.0, at: start.addingTimeInterval(Double(i))) }
        XCTAssertEqual(reference.zero, 1.0)

        // One wild reading must not move it.
        reference.noteGroundReading(400, at: start.addingTimeInterval(7))
        XCTAssertEqual(reference.zero, 1.0)
    }

    func testHeightIsMeasuredFromTheZero() {
        var reference = BaroReference()
        for i in 0...6 { reference.noteGroundReading(12.0, at: start.addingTimeInterval(Double(i))) }
        XCTAssertEqual(reference.height(for: 112.0, at: start.addingTimeInterval(60)), 100)
    }

    /// Pressure drifts with the weather, so an old zero is not a surface.
    func testStaleZeroIsRefused() {
        var reference = BaroReference()
        for i in 0...6 { reference.noteGroundReading(0, at: start.addingTimeInterval(Double(i))) }
        XCTAssertNil(reference.height(for: 100, at: start.addingTimeInterval(6 * 3600)))
    }

    // MARK: - Detector fusion

    /// A phone with a barometer detects the flight with no terrain data at all —
    /// the pressure sensor measures height above the surface directly.
    func testBarometricHeightWorksWithoutAnyTerrainSource() {
        let fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start)
        let detector = FlightDetector(profile: .pistonSingle)
        var events: [FlightEvent] = []
        for fix in fixes {
            // The barometer measures what the GPS altitude would, minus the
            // field elevation — but without the GPS vertical noise.
            let motion = MotionSample(baroAGL: fix.altitude - 250, climbRate: nil)
            events.append(contentsOf: detector.ingest(fix, elevation: nil, motion: motion))
        }
        let air = events.filter(\.kind.isAirEvent)
        XCTAssertEqual(air.map(\.kind), [.takeoff, .landing])
        XCTAssertEqual(air.first?.confidence, .high, "a barometric height is not a guess")
    }

    /// Passing no motion must leave the detector behaving exactly as before.
    func testNilMotionChangesNothing() {
        let fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start)
        func run(withMotion: Bool) -> [Date] {
            let detector = FlightDetector(profile: .pistonSingle)
            var times: [Date] = []
            for fix in fixes {
                let events = detector.ingest(
                    fix,
                    elevation: ElevationSample(meters: 250, source: .groundReference),
                    motion: withMotion ? MotionSample() : nil
                )
                times.append(contentsOf: events.filter(\.kind.isAirEvent).map(\.time))
            }
            return times
        }
        // An empty MotionSample carries no data, so it must not change anything.
        XCTAssertEqual(run(withMotion: true), run(withMotion: false))
    }

    // MARK: - Accelerometer gate

    func testShakenPhoneCannotDefineTheGround() {
        let profile = DetectionProfile.pistonSingle
        let calm = MotionSample(acceleration: 0.02)
        let shaken = MotionSample(acceleration: 0.9)
        XCTAssertTrue(profile.acceptsGroundSample(phase: .onGround, speed: 1, agl: 0, motion: calm))
        XCTAssertFalse(profile.acceptsGroundSample(phase: .onGround, speed: 1, agl: 0, motion: shaken))
        // Without motion data the rule is unchanged.
        XCTAssertTrue(profile.acceptsGroundSample(phase: .onGround, speed: 1, agl: 0, motion: nil))
    }

    func testEmptySampleReportsNoData() {
        XCTAssertFalse(MotionSample().hasData)
        XCTAssertTrue(MotionSample(climbRate: 2).hasData)
        XCTAssertTrue(MotionSample().isPlausiblyAtRest, "no reading is not evidence of movement")
    }
}
