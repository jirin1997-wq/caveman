import XCTest
@testable import FlightLogger

/// Detection tests run entirely on synthetic tracks — no device, no GPS, no
/// permission dialog. Every scenario here is one that broke a naive detector.
final class FlightDetectorTests: XCTestCase {

    private let field = Coordinate(latitude: 49.9, longitude: 15.0)

    /// Replays a track and returns every event the detector emitted.
    private func run(
        _ fixes: [Fix],
        profile: DetectionProfile = .pistonSingle,
        elevation: Double?
    ) -> [FlightEvent] {
        let detector = FlightDetector(profile: profile)
        var events: [FlightEvent] = []
        for fix in fixes {
            let sample = elevation.map { ElevationSample(meters: $0, source: .groundReference) }
            events.append(contentsOf: detector.ingest(fix, elevation: sample))
        }
        return events
    }

    // MARK: - The basic case

    func testStandardFlightProducesOneTakeoffAndOneLanding() {
        let fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250)
        let events = run(fixes, elevation: 250)

        XCTAssertEqual(events.map(\.kind), [.takeoff, .landing])
        XCTAssertEqual(events[0].confidence, .high)
        XCTAssertEqual(events[1].confidence, .high)
    }

    /// The event must be stamped at wheels-off, not at the moment the detector
    /// finished convincing itself. The generated track rotates 105 s in
    /// (90 s taxi + 15 s roll); five seconds of slack either way is plenty.
    func testTakeoffIsBackdatedToTheRotation() {
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        let fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start)
        let events = run(fixes, elevation: 250)

        guard let takeoff = events.first(where: { $0.kind == .takeoff }) else {
            return XCTFail("no takeoff detected")
        }
        let offset = takeoff.time.timeIntervalSince(start)
        XCTAssertGreaterThan(offset, 95, "takeoff stamped before the aircraft even rolled")
        XCTAssertLessThan(offset, 135, "takeoff stamped long after rotation — backdating failed")
    }

    // MARK: - The cases that need both signals

    /// Sixty knots down the runway with the wheels on it. Speed alone would call
    /// this a departure; the AGL test is what stops it.
    func testFastTaxiIsNotATakeoff() {
        let fixes = SyntheticTrack.fastTaxiNoTakeoff(origin: field, fieldElevation: 250)
        let events = run(fixes, elevation: 250)
        XCTAssertTrue(events.isEmpty, "fast taxi logged as \(events.map(\.kind))")
    }

    /// A field at 2000 m MSL. Any detector using raw altitude as "airborne"
    /// reports this aircraft as flying while it is still parked.
    func testHighAltitudeFieldStillDetectsCorrectly() {
        let fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 2_000)
        let events = run(fixes, elevation: 2_000)

        XCTAssertEqual(events.map(\.kind), [.takeoff, .landing])
        guard let takeoff = events.first else { return XCTFail("no takeoff") }
        XCTAssertNotNil(takeoff.agl)
        XCTAssertLessThan(takeoff.agl ?? .infinity, 200, "AGL should be small at the moment of rotation")
    }

    /// Same track, but the app never learned the field elevation. Detection must
    /// still work off speed and climb rate, and must say it is less sure.
    func testWithoutTerrainFallsBackToSpeedAndClimb() {
        let fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250)
        let events = run(fixes, elevation: nil)

        XCTAssertEqual(events.map(\.kind), [.takeoff, .landing])
        XCTAssertEqual(events[0].confidence, .low)
        XCTAssertNil(events[0].agl)
    }

    // MARK: - Circuits

    func testTouchAndGoProducesTwoOfEach() {
        let fixes = SyntheticTrack.touchAndGo(origin: field, fieldElevation: 250)
        let events = run(fixes, elevation: 250)

        XCTAssertEqual(events.filter { $0.kind == .takeoff }.count, 2)
        XCTAssertEqual(events.filter { $0.kind == .landing }.count, 2)
        XCTAssertEqual(events.first?.kind, .takeoff)
        XCTAssertEqual(events.last?.kind, .landing)
    }

    // MARK: - Bad data

    /// Opening the app at cruise must adopt the airborne state silently. There
    /// is no honest takeoff time to write down.
    func testStartingMidFlightDoesNotInventATakeoff() {
        let all = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250)
        // Skip taxi, roll and initial climb — start the tape in the cruise.
        let cruise = Array(all.dropFirst(300))
        let events = run(cruise, elevation: 250)

        XCTAssertEqual(events.map(\.kind), [.landing], "expected only the landing, got \(events.map(\.kind))")
    }

    /// Fixes with useless accuracy are dropped rather than reasoned about.
    func testGarbageAccuracyFixesAreIgnored() {
        var fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250)
        for index in fixes.indices where index % 7 == 0 {
            fixes[index].horizontalAccuracy = 400
        }
        let events = run(fixes, elevation: 250)
        XCTAssertEqual(events.map(\.kind), [.takeoff, .landing])
    }

    /// A signal blackout longer than a minute resets the state machine, so the
    /// detector never bridges a gap it did not observe.
    func testLongSignalGapDoesNotFabricateEvents() {
        let all = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250)
        // Drop the entire departure: taxi, roll, rotation and climb.
        var fixes = Array(all.prefix(60))
        let resumed = all.dropFirst(400).map { fix -> Fix in
            var copy = fix
            copy.timestamp = fix.timestamp.addingTimeInterval(600)
            return copy
        }
        fixes.append(contentsOf: resumed)

        let events = run(fixes, elevation: 250)
        XCTAssertFalse(events.contains { $0.kind == .takeoff }, "invented a takeoff across a 10-minute gap")
    }

    /// Receivers that do not report speed (some external Bluetooth GPS) must
    /// still work — speed is derived from consecutive positions.
    func testDerivedSpeedWhenReceiverReportsNone() {
        let fixes = SyntheticTrack.make(
            origin: field,
            startAltitude: 250,
            start: Date(timeIntervalSince1970: 1_700_000_000),
            segments: [
                .init(duration: 60, speed: Units.knotsToMps(5)),
                .init(duration: 15, speedFrom: Units.knotsToMps(5), speedTo: Units.knotsToMps(65)),
                .init(duration: 20, speedFrom: Units.knotsToMps(65), speedTo: Units.knotsToMps(75),
                      climbFrom: 1, climbTo: 4),
                .init(duration: 120, speed: Units.knotsToMps(85), climb: 4),
                .init(duration: 175, speed: Units.knotsToMps(85), climb: -3),
                .init(duration: 20, speedFrom: Units.knotsToMps(70), speedTo: Units.knotsToMps(50),
                      climbFrom: -0.5, climbTo: 0),
                .init(duration: 25, speedFrom: Units.knotsToMps(50), speedTo: Units.knotsToMps(5)),
                .init(duration: 60, speed: Units.knotsToMps(5))
            ],
            horizontalNoise: 1,
            verticalNoise: 2,
            reportSpeed: false
        )
        let events = run(fixes, elevation: 250)
        XCTAssertEqual(events.map(\.kind), [.takeoff, .landing])
    }

    // MARK: - Profiles

    /// A glider leaves the ground well below a piston single's rotate speed.
    /// With the wrong profile the same track logs nothing.
    func testGliderProfileCatchesASlowLaunch() {
        let fixes = SyntheticTrack.make(
            origin: field,
            startAltitude: 250,
            start: Date(timeIntervalSince1970: 1_700_000_000),
            segments: [
                .init(duration: 60, speed: Units.knotsToMps(3)),
                .init(duration: 12, speedFrom: Units.knotsToMps(3), speedTo: Units.knotsToMps(35)),
                .init(duration: 40, speed: Units.knotsToMps(38), climb: 3),
                .init(duration: 180, speed: Units.knotsToMps(42), climb: 1),
                .init(duration: 145, speed: Units.knotsToMps(40), climb: -2),
                .init(duration: 20, speedFrom: Units.knotsToMps(35), speedTo: Units.knotsToMps(20),
                      climbFrom: -1, climbTo: 0),
                .init(duration: 20, speedFrom: Units.knotsToMps(20), speedTo: Units.knotsToMps(2)),
                .init(duration: 60, speed: Units.knotsToMps(2))
            ]
        )

        let asGlider = run(fixes, profile: .glider, elevation: 250)
        XCTAssertEqual(asGlider.map(\.kind), [.takeoff, .landing])

        let asPiston = run(fixes, profile: .pistonSingle, elevation: 250)
        XCTAssertTrue(asPiston.isEmpty, "piston thresholds should be too high for a glider launch")
    }
}
