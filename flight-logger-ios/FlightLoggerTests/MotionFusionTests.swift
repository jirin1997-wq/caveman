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

    // MARK: - Barometric climb rate

    func testClimbRateComesOutOfSuccessiveReadings() {
        var rate = BaroRate()
        rate.note(0, at: start)
        XCTAssertNil(rate.rate, "one reading is not a rate")

        // Two metres a second, sampled once a second.
        for i in 1...20 { rate.note(Double(i) * 2, at: start.addingTimeInterval(Double(i))) }
        XCTAssertEqual(rate.rate ?? 0, 2, accuracy: 0.05)
    }

    /// A reading that arrives after the sensor stalled says nothing about the
    /// current climb. Dividing the drift that accumulated over a minute by an
    /// assumed one-second gap would invent a rate the aircraft never had.
    func testAStalledSensorDoesNotInventAClimb() {
        var rate = BaroRate()
        rate.note(0, at: start)
        rate.note(60, at: start.addingTimeInterval(60))
        XCTAssertNil(rate.rate)
    }

    func testReadingsTooCloseTogetherAreIgnored() {
        var rate = BaroRate()
        rate.note(0, at: start)
        rate.note(0.01, at: start.addingTimeInterval(0.05))
        XCTAssertNil(rate.rate, "50 ms apart is noise, not a climb")
    }

    func testSmoothingDampensASingleSpike() {
        var rate = BaroRate()
        for i in 0...10 { rate.note(Double(i) * 2, at: start.addingTimeInterval(Double(i))) }
        let steady = rate.rate ?? 0

        // One reading 20 m out of place.
        rate.note(20 * 2 + 20, at: start.addingTimeInterval(11))
        let spiked = rate.rate ?? 0
        XCTAssertGreaterThan(spiked, steady)
        XCTAssertLessThan(spiked, 22, "a single bad reading must not pass through whole")
    }

    func testResetForgetsEverything() {
        var rate = BaroRate()
        for i in 0...5 { rate.note(Double(i), at: start.addingTimeInterval(Double(i))) }
        XCTAssertNotNil(rate.rate)
        rate.reset()
        XCTAssertNil(rate.rate)
    }

    // MARK: - Acceleration window

    func testWindowAveragesAndMeasuresVibration() {
        var window = MotionWindow()
        XCTAssertNil(window.mean)
        XCTAssertNil(window.deviation)

        for _ in 0..<10 { window.append(0.2) }
        XCTAssertEqual(window.mean ?? 0, 0.2, accuracy: 1e-9)
        XCTAssertEqual(window.deviation ?? 1, 0, accuracy: 1e-9, "a steady reading does not vibrate")

        var shaking = MotionWindow()
        for i in 0..<10 { shaking.append(i.isMultiple(of: 2) ? 0.1 : 0.3) }
        XCTAssertEqual(shaking.mean ?? 0, 0.2, accuracy: 1e-9)
        XCTAssertEqual(shaking.deviation ?? 0, 0.1, accuracy: 1e-9)
    }

    func testWindowKeepsOnlyTheRecentPast() {
        var window = MotionWindow(capacity: 5)
        for i in 0..<100 { window.append(Double(i)) }
        XCTAssertEqual(window.values.count, 5)
        XCTAssertEqual(window.values, [95, 96, 97, 98, 99])
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
