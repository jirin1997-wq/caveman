import XCTest
@testable import FlightLogger

final class TrackBufferTests: XCTestCase {

    private func point(_ i: Int) -> TrackPoint {
        TrackPoint(
            fix: Fix(
                timestamp: Date(timeIntervalSince1970: 1_700_000_000 + Double(i)),
                latitude: 49.9 + Double(i) * 0.0001,
                longitude: 15.0,
                altitude: 250 + Double(i)
            ),
            agl: Double(i),
            speed: 30
        )
    }

    func testStaysWithinCapacity() {
        var buffer = TrackBuffer(capacity: 100)
        for i in 0..<10_000 { buffer.append(point(i)) }
        XCTAssertLessThanOrEqual(buffer.points.count, 100)
        XCTAssertGreaterThan(buffer.points.count, 40, "thinning should not starve the line")
    }

    /// The ends of the line are the two points that must never be dropped: one
    /// is where the flight started, the other is where the aircraft is now.
    func testKeepsBothEnds() {
        var buffer = TrackBuffer(capacity: 16)
        for i in 0..<1_000 { buffer.append(point(i)) }
        XCTAssertEqual(buffer.points.first, point(0))
        XCTAssertEqual(buffer.points.last, point(999))
        XCTAssertEqual(buffer.latest, point(999))
    }

    func testOrderIsPreserved() {
        var buffer = TrackBuffer(capacity: 32)
        for i in 0..<500 { buffer.append(point(i)) }
        let times = buffer.points.map(\.t)
        XCTAssertEqual(times, times.sorted(), "the polyline would zig-zag")
    }

    /// Below the cap nothing is dropped at all.
    func testSmallTrackIsUntouched() {
        var buffer = TrackBuffer(capacity: 100)
        for i in 0..<50 { buffer.append(point(i)) }
        XCTAssertEqual(buffer.points.count, 50)
        XCTAssertEqual(buffer.resolution, 1)
    }

    func testResolutionReportsWhatWasLost() {
        var buffer = TrackBuffer(capacity: 16)
        for i in 0..<100 { buffer.append(point(i)) }
        XCTAssertGreaterThan(buffer.resolution, 1)
    }

    func testResetClears() {
        var buffer = TrackBuffer(capacity: 16)
        for i in 0..<100 { buffer.append(point(i)) }
        buffer.reset()
        XCTAssertTrue(buffer.isEmpty)
        XCTAssertEqual(buffer.resolution, 1)
        XCTAssertNil(buffer.latest)
    }
}
