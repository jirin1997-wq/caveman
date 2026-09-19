import XCTest
@testable import FlightLogger

/// The recorder's own job: turning the detector's four events into one logbook
/// entry with both times on it. The detector is tested separately; what is
/// under test here is the wiring between them.
@MainActor
final class RecorderBlockTests: XCTestCase {

    private var directory: URL!
    private let field = Coordinate(latitude: 49.9, longitude: 15.0)
    private let start = Date(timeIntervalSince1970: 1_700_000_000)

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("RecorderBlockTests-\(UUID().uuidString)")
        AppPaths.useDirectory(directory)
    }

    override func tearDown() {
        AppPaths.useDirectory(nil)
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    private func makeRecorder() -> FlightRecorder {
        let settings = AppSettings()
        settings.profile = .pistonSingle
        settings.aircraft = "OK-TST"
        // Explicit: the apron test is only meaningful with learning switched on.
        settings.learnAirfields = true
        return FlightRecorder(store: FlightStore(), settings: settings)
    }

    private func replay(_ fixes: [Fix], through recorder: FlightRecorder) {
        for fix in fixes { recorder.ingest(fix) }
    }

    // MARK: - A whole flight

    func testAFlightGetsBothTimes() {
        let recorder = makeRecorder()
        replay(
            SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start),
            through: recorder
        )

        XCTAssertEqual(recorder.store.flights.count, 1)
        guard let flight = recorder.store.flights.first else { return }

        XCTAssertNotNil(flight.offBlocks, "block time never started")
        XCTAssertNotNil(flight.onBlocks, "block time never closed")
        XCTAssertNotNil(flight.duration)
        XCTAssertNotNil(flight.blockTime)

        // Both numbers, and the block one is the longer of the two.
        XCTAssertGreaterThan(flight.blockTime!, flight.duration!)
        XCTAssertEqual(flight.taxiTime!, flight.blockTime! - flight.duration!, accuracy: 1)
        XCTAssertEqual(flight.aircraft, "OK-TST")
        XCTAssertFalse(flight.isOpen)
    }

    /// The taxi out belongs to the flight it preceded, not to the one before it.
    func testTaxiOutIsMeasuredFromTheRoll() {
        let recorder = makeRecorder()
        replay(
            SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start),
            through: recorder
        )
        guard let flight = recorder.store.flights.first, let taxiOut = flight.taxiOut else {
            return XCTFail("no taxi out")
        }
        // The generated track taxis for 90 s and then rolls.
        XCTAssertGreaterThan(taxiOut, 60)
        XCTAssertLessThan(taxiOut, 160)
    }

    // MARK: - Movement that is not a flight

    /// Pushing the aircraft around the apron produces block events and no
    /// flight. Nothing may reach the logbook, and — since the detector still
    /// reports the movement — no airfield may be invented for it either.
    func testTaxiingWithoutFlyingLogsNothing() {
        let recorder = makeRecorder()
        let learnedBefore = recorder.airports.learned.count

        replay(
            SyntheticTrack.make(
                origin: field,
                startAltitude: 250,
                start: start,
                segments: [
                    .init(duration: 20, speed: 0),
                    .init(duration: 120, speed: Units.knotsToMps(12)),
                    .init(duration: 90, speed: 0)
                ]
            ),
            through: recorder
        )

        XCTAssertTrue(recorder.store.flights.isEmpty)
        XCTAssertNil(recorder.currentFlight)
        XCTAssertEqual(
            recorder.airports.learned.count, learnedBefore,
            "shuffling the aircraft on the apron must not mint an airfield"
        )
    }

    // MARK: - Two flights in a row

    /// The second flight's off-blocks must not be attached to the first, and the
    /// first flight's on-blocks must not be stolen by the second.
    func testTwoFlightsKeepTheirOwnBlockTimes() {
        let recorder = makeRecorder()
        let first = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start)
        let gap = start.addingTimeInterval(Double(first.count) + 600)
        let second = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: gap)

        replay(first + second, through: recorder)

        XCTAssertEqual(recorder.store.flights.count, 2)
        for flight in recorder.store.flights {
            guard let off = flight.offBlocks, let on = flight.onBlocks else {
                return XCTFail("a flight lost one of its block events")
            }
            XCTAssertLessThan(off.time, flight.takeoff.time)
            XCTAssertGreaterThan(on.time, flight.landing!.time)
            XCTAssertLessThan(flight.blockTime!, 1_200, "block time swallowed the other flight")
        }
    }

    // MARK: - The live track

    /// The drawing track starts filling while the aircraft is still taxiing,
    /// which is the whole point of drawing it live.
    func testTheLiveTrackRecordsTheTaxiToo() {
        let recorder = makeRecorder()
        let fixes = SyntheticTrack.standardFlight(origin: field, fieldElevation: 250, start: start)

        // Only the taxi out, before any takeoff.
        replay(Array(fixes.prefix(60)), through: recorder)

        XCTAssertNil(recorder.currentFlight, "not airborne yet")
        XCTAssertGreaterThan(recorder.liveTrack.points.count, 10, "nothing was drawn")
    }
}
