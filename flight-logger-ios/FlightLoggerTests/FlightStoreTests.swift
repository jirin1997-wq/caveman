import XCTest
@testable import FlightLogger

/// The logbook's persistence: what survives a restart, what a rename reaches,
/// and what the exports actually contain.
@MainActor
final class FlightStoreTests: XCTestCase {

    private var directory: URL!

    override func setUp() {
        super.setUp()
        directory = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("FlightStoreTests-\(UUID().uuidString)")
        AppPaths.useDirectory(directory)
    }

    override func tearDown() {
        AppPaths.useDirectory(nil)
        try? FileManager.default.removeItem(at: directory)
        super.tearDown()
    }

    // MARK: - Fixtures

    private func event(
        _ kind: FlightEventKind,
        at offset: TimeInterval,
        airport: String? = nil
    ) -> FlightEvent {
        FlightEvent(
            kind: kind,
            time: Date(timeIntervalSince1970: 1_700_000_000 + offset),
            latitude: 49.9,
            longitude: 15.0,
            altitude: 250 + offset,
            agl: offset,
            groundElevation: 250,
            elevationSource: .groundReference,
            speed: 30,
            confidence: .high,
            airport: airport
        )
    }

    private func completeFlight(airport: String? = "Plocha 1") -> Flight {
        var flight = Flight(takeoff: event(.takeoff, at: 100, airport: airport), landing: nil)
        flight.landing = event(.landing, at: 3_700, airport: airport)
        flight.offBlocks = event(.offBlocks, at: 0, airport: airport)
        flight.onBlocks = event(.onBlocks, at: 3_900, airport: airport)
        flight.aircraft = "OK-ABC"
        return flight
    }

    // MARK: - Persistence

    func testAFlightSurvivesAReload() {
        let store = FlightStore()
        store.upsert(completeFlight())

        let reopened = FlightStore()
        XCTAssertEqual(reopened.flights.count, 1)
        XCTAssertEqual(reopened.flights.first?.aircraft, "OK-ABC")
        XCTAssertEqual(reopened.flights.first?.blockTime, 3_900)
        XCTAssertEqual(reopened.flights.first?.duration, 3_600)
    }

    func testUpsertReplacesRatherThanDuplicates() {
        let store = FlightStore()
        var flight = completeFlight()
        store.upsert(flight)
        flight.note = "první sólo"
        store.upsert(flight)

        XCTAssertEqual(store.flights.count, 1)
        XCTAssertEqual(store.flights.first?.note, "první sólo")
    }

    func testOpenFlightIsTheOneWithoutALanding() {
        let store = FlightStore()
        store.upsert(completeFlight())
        let open = Flight(takeoff: event(.takeoff, at: 10_000), landing: nil)
        store.upsert(open)

        XCTAssertEqual(store.openFlight?.id, open.id)
    }

    func testNewestFlightIsFirst() {
        let store = FlightStore()
        let older = Flight(takeoff: event(.takeoff, at: 0), landing: event(.landing, at: 100))
        let newer = Flight(takeoff: event(.takeoff, at: 50_000), landing: event(.landing, at: 51_000))
        store.upsert(older)
        store.upsert(newer)

        XCTAssertEqual(store.flights.map(\.id), [newer.id, older.id])
    }

    // MARK: - Tracks

    func testTrackRoundTrips() {
        let store = FlightStore()
        let flight = completeFlight()
        store.upsert(flight)

        let points = (0..<5).map { i in
            TrackPoint(
                fix: Fix(
                    timestamp: Date(timeIntervalSince1970: 1_700_000_000 + Double(i)),
                    latitude: 49.9 + Double(i) * 0.001,
                    longitude: 15.0,
                    altitude: 300 + Double(i)
                ),
                agl: Double(i * 10),
                speed: 40,
                vs: 2.5
            )
        }
        store.appendTrack(Array(points.prefix(3)), to: flight.id)
        store.appendTrack(Array(points.suffix(2)), to: flight.id)

        let read = store.track(for: flight.id)
        XCTAssertEqual(read.count, 5)
        XCTAssertEqual(read.map(\.t), points.map(\.t))
        XCTAssertEqual(read.last?.vs, 2.5, "vertical speed must survive the file")
    }

    func testDeletingAFlightRemovesItsTrack() {
        let store = FlightStore()
        let flight = completeFlight()
        store.upsert(flight)
        store.appendTrack(
            [TrackPoint(fix: Fix(timestamp: Date(), latitude: 49.9, longitude: 15, altitude: 250),
                        agl: 0, speed: 0)],
            to: flight.id
        )
        XCTAssertFalse(store.track(for: flight.id).isEmpty)

        store.delete(flight)
        XCTAssertTrue(store.flights.isEmpty)
        XCTAssertTrue(store.track(for: flight.id).isEmpty)
    }

    // MARK: - Renaming an airfield

    /// A rename has to reach every event that named the old code. Block events
    /// are events too — leaving them behind renames the flight only halfway.
    func testRenamingReachesAllFourEvents() {
        let store = FlightStore()
        store.upsert(completeFlight(airport: "Plocha 1"))

        store.relabelAirport(from: "Plocha 1", to: "LKHN")

        let flight = store.flights[0]
        XCTAssertEqual(flight.takeoff.airport, "LKHN")
        XCTAssertEqual(flight.landing?.airport, "LKHN")
        XCTAssertEqual(flight.offBlocks?.airport, "LKHN")
        XCTAssertEqual(flight.onBlocks?.airport, "LKHN")
    }

    func testRenamingLeavesOtherAirfieldsAlone() {
        let store = FlightStore()
        var flight = completeFlight(airport: "Plocha 1")
        flight.landing?.airport = "LKZA"
        store.upsert(flight)

        store.relabelAirport(from: "Plocha 1", to: "LKHN")

        XCTAssertEqual(store.flights[0].takeoff.airport, "LKHN")
        XCTAssertEqual(store.flights[0].landing?.airport, "LKZA")
    }

    // MARK: - Export

    func testCSVCarriesBothTimes() {
        let store = FlightStore()
        store.upsert(completeFlight())

        guard let url = store.exportLogbookCSV() else { return XCTFail("no CSV") }
        let csv = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        let lines = csv.split(separator: "\n")

        XCTAssertTrue(lines[0].contains("blokovy_cas"))
        XCTAssertTrue(lines[0].contains("off_blocks"))
        XCTAssertEqual(lines.count, 2, "header plus one flight")
        XCTAssertTrue(lines[1].contains("OK-ABC"))
        XCTAssertTrue(lines[1].contains("1:05"), "block time of 3900 s is 1:05")
    }

    func testGPXNeedsATrackAndIsWellFormed() {
        let store = FlightStore()
        let flight = completeFlight()
        store.upsert(flight)

        XCTAssertNil(store.exportGPX(flight), "no track points, nothing to export")

        store.appendTrack(
            (0..<3).map { i in
                TrackPoint(
                    fix: Fix(timestamp: Date(timeIntervalSince1970: 1_700_000_000 + Double(i)),
                             latitude: 49.9, longitude: 15.0, altitude: 250),
                    agl: 0, speed: 10
                )
            },
            to: flight.id
        )

        guard let url = store.exportGPX(flight) else { return XCTFail("no GPX") }
        let gpx = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        XCTAssertTrue(gpx.hasPrefix("<?xml"))
        XCTAssertTrue(gpx.contains("<gpx"))
        XCTAssertTrue(gpx.contains("</gpx>"))
        XCTAssertEqual(gpx.components(separatedBy: "<trkpt").count - 1, 3)
    }
}
