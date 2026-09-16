import XCTest
@testable import FlightLogger

/// Block time — off-blocks to on-blocks — is the other number a logbook wants,
/// and it is not derivable from the flight time: it depends on how long the
/// aircraft spent rolling around on the ground at each end.
final class BlockTimeTests: XCTestCase {

    private let field = Coordinate(latitude: 49.9, longitude: 15.0)
    private let start = Date(timeIntervalSince1970: 1_700_000_000)

    private func run(_ fixes: [Fix], profile: DetectionProfile = .pistonSingle) -> [FlightEvent] {
        let detector = FlightDetector(profile: profile)
        var events: [FlightEvent] = []
        for fix in fixes {
            events.append(contentsOf: detector.ingest(
                fix,
                elevation: ElevationSample(meters: 250, source: .groundReference)
            ))
        }
        return events
    }

    func testAFullFlightProducesAllFourEvents() {
        let events = run(SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start))
        XCTAssertEqual(events.map(\.kind), [.offBlocks, .takeoff, .landing, .onBlocks])
    }

    /// The whole point of the pair: block time is longer than flight time, by
    /// exactly the taxi at both ends.
    func testBlockTimeIsLongerThanFlightTime() {
        let events = run(SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start))
        guard let off = events.first(where: { $0.kind == .offBlocks }),
              let takeoff = events.first(where: { $0.kind == .takeoff }),
              let landing = events.first(where: { $0.kind == .landing }),
              let on = events.first(where: { $0.kind == .onBlocks }) else {
            return XCTFail("expected all four events, got \(events.map(\.kind))")
        }

        let flightTime = landing.time.timeIntervalSince(takeoff.time)
        let blockTime = on.time.timeIntervalSince(off.time)
        XCTAssertGreaterThan(blockTime, flightTime)

        // The generated track taxis out for 90 s and back in for 90 s.
        let taxiOut = takeoff.time.timeIntervalSince(off.time)
        XCTAssertGreaterThan(taxiOut, 60)
        XCTAssertLessThan(taxiOut, 160)
    }

    func testBlockEventsAreBackdatedNotStampedAtConfirmation() {
        let events = run(SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start))
        guard let off = events.first(where: { $0.kind == .offBlocks }) else {
            return XCTFail("no off-blocks")
        }
        // The aircraft starts rolling on the first fix; confirmation takes 10 s,
        // and the event must be stamped at the roll, not at the confirmation.
        XCTAssertLessThan(off.time.timeIntervalSince(start), 8)
    }

    /// Holding short of the runway is not the end of a flight. The stop dwell
    /// is long precisely so a pause on the way out cannot close the block.
    func testHoldingShortDoesNotEndTheBlock() {
        let fixes = SyntheticTrack.make(
            origin: field,
            startAltitude: 250,
            start: start,
            segments: [
                .init(duration: 20, speed: 0),
                .init(duration: 60, speed: Units.knotsToMps(10)),   // taxi out
                .init(duration: 30, speed: 0),                      // holding short
                .init(duration: 60, speed: Units.knotsToMps(10)),   // line up
                .init(duration: 15, speedFrom: Units.knotsToMps(10), speedTo: Units.knotsToMps(65)),
                .init(duration: 20, speedFrom: Units.knotsToMps(65), speedTo: Units.knotsToMps(75),
                      climbFrom: 1, climbTo: 4),
                .init(duration: 120, speed: Units.knotsToMps(85), climb: 4)
            ]
        )
        let events = run(fixes)
        XCTAssertEqual(events.filter { $0.kind == .offBlocks }.count, 1,
                       "a 30 s hold must not close and reopen the block")
        XCTAssertTrue(events.contains { $0.kind == .onBlocks } == false,
                      "the aircraft never stopped for long enough to be on blocks")
    }

    /// Taxiing to the hangar and back with no flight in between produces block
    /// events and no flight — which is correct, and the recorder drops them.
    func testTaxiWithoutFlyingLogsNoTakeoff() {
        let fixes = SyntheticTrack.make(
            origin: field,
            startAltitude: 250,
            start: start,
            segments: [
                .init(duration: 20, speed: 0),
                .init(duration: 120, speed: Units.knotsToMps(12)),
                .init(duration: 90, speed: 0)
            ]
        )
        let events = run(fixes)
        XCTAssertEqual(events.map(\.kind), [.offBlocks, .onBlocks])
    }
}
