import XCTest
@testable import FlightLogger

/// The rule that decides which fixes may define "where the ground is".
///
/// Getting this wrong is expensive in both directions: too strict and the app
/// never learns a field elevation, too loose and a fix taken in the air becomes
/// the terrain every later AGL is measured against.
final class GroundSampleTests: XCTestCase {

    private let piston = DetectionProfile.pistonSingle

    func testTaxiSpeedCounts() {
        XCTAssertTrue(piston.acceptsGroundSample(phase: .onGround, speed: 0, agl: 0))
        XCTAssertTrue(piston.acceptsGroundSample(phase: .onGround, speed: Units.knotsToMps(10), agl: 0))
    }

    /// A floatplane is never stopped — it drifts and idles across the water
    /// from engine start to liftoff. Requiring a standstill would mean it never
    /// measures the surface it is floating on.
    func testDriftingOnWaterStillCounts() {
        let drifting = Units.knotsToMps(5)
        XCTAssertGreaterThan(drifting, 2, "a drifting floatplane is above the old fixed 2 m/s limit")
        XCTAssertTrue(piston.acceptsGroundSample(phase: .onGround, speed: drifting, agl: 0))
    }

    func testFlyingSpeedDoesNotCount() {
        XCTAssertFalse(piston.acceptsGroundSample(phase: .onGround, speed: Units.knotsToMps(40), agl: 0))
        XCTAssertFalse(piston.acceptsGroundSample(phase: .airborne, speed: 0, agl: 0))
        XCTAssertFalse(piston.acceptsGroundSample(phase: .approach, speed: 0, agl: 0))
    }

    /// A helicopter in a slow hover is moving like a taxiing aircraft and is
    /// nowhere near the ground. The AGL guard is what catches it.
    func testLowHoverDoesNotCount() {
        XCTAssertFalse(piston.acceptsGroundSample(phase: .onGround, speed: 1, agl: 120))
        // Just off the surface is still fine — that is GPS noise, not a hover.
        XCTAssertTrue(piston.acceptsGroundSample(phase: .onGround, speed: 1, agl: 8))
    }

    func testUnknownAltitudeIsNotAnObstacle() {
        XCTAssertTrue(piston.acceptsGroundSample(phase: .unknown, speed: 1, agl: nil))
    }

    func testMissingSpeedIsRejected() {
        XCTAssertFalse(piston.acceptsGroundSample(phase: .onGround, speed: -1, agl: 0))
    }

    /// The threshold scales with the aircraft, and never drops below walking
    /// pace even for the slowest profile.
    func testThresholdScalesWithProfile() {
        XCTAssertGreaterThan(DetectionProfile.turbine.groundSampleSpeed, DetectionProfile.glider.groundSampleSpeed)
        for profile in DetectionProfile.presets {
            XCTAssertGreaterThanOrEqual(profile.groundSampleSpeed, 2)
            XCTAssertLessThan(profile.groundSampleSpeed, profile.landingSpeed, "must stay clear of flying speed")
        }
    }
}
