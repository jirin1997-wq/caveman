import Foundation

/// Thresholds the detector compares every fix against.
///
/// A glider leaves the ground around 30 kt, a turboprop nearer 90. One set of
/// numbers cannot serve both, so the profile is per aircraft and lives in
/// settings. All values SI.
struct DetectionProfile: Codable, Equatable, Sendable {
    var name: String

    /// Ground speed above which the aircraft may be taking off.
    var takeoffSpeed: Double
    /// Ground speed below which the aircraft may have landed. Kept clearly
    /// below `takeoffSpeed` — that gap is the hysteresis that stops a fast
    /// rollout or a gust from flipping the state back and forth.
    var landingSpeed: Double

    /// Height above terrain that means "definitely flying".
    var airborneAGL: Double
    /// Height above terrain that means "on or just above the runway".
    var groundAGL: Double

    /// Vertical speed that counts as a real climb or descent, m/s.
    var climbRate: Double

    /// How long every condition must hold before the event is emitted. The
    /// event itself is backdated to the start of this window.
    var confirmDuration: TimeInterval

    /// Fixes worse than this are dropped outright.
    var maxHorizontalAccuracy: Double

    /// A takeoff this soon after a landing is a touch-and-go.
    var touchAndGoWindow: TimeInterval

    /// Seconds of altitude history used for the climb-rate regression.
    var climbWindow: TimeInterval

    /// A ground reference this far from the current position is no longer
    /// trusted as the terrain elevation underneath the aircraft.
    var referenceValidRadius: Double

    static let glider = DetectionProfile(
        name: "Kluzák",
        takeoffSpeed: Units.knotsToMps(25),
        landingSpeed: Units.knotsToMps(18),
        airborneAGL: 25,
        groundAGL: 12,
        climbRate: 0.5,
        confirmDuration: 5,
        maxHorizontalAccuracy: 50,
        touchAndGoWindow: 60,
        climbWindow: 6,
        referenceValidRadius: 15_000
    )

    static let ultralight = DetectionProfile(
        name: "Ultralight",
        takeoffSpeed: Units.knotsToMps(30),
        landingSpeed: Units.knotsToMps(22),
        airborneAGL: 30,
        groundAGL: 15,
        climbRate: 0.5,
        confirmDuration: 5,
        maxHorizontalAccuracy: 50,
        touchAndGoWindow: 60,
        climbWindow: 6,
        referenceValidRadius: 15_000
    )

    static let pistonSingle = DetectionProfile(
        name: "Motorové (píst)",
        takeoffSpeed: Units.knotsToMps(45),
        landingSpeed: Units.knotsToMps(32),
        airborneAGL: 40,
        groundAGL: 18,
        climbRate: 0.6,
        confirmDuration: 5,
        maxHorizontalAccuracy: 50,
        touchAndGoWindow: 60,
        climbWindow: 6,
        referenceValidRadius: 15_000
    )

    static let turbine = DetectionProfile(
        name: "Turbína / dopravní",
        takeoffSpeed: Units.knotsToMps(70),
        landingSpeed: Units.knotsToMps(50),
        airborneAGL: 60,
        groundAGL: 25,
        climbRate: 1.0,
        confirmDuration: 6,
        maxHorizontalAccuracy: 60,
        touchAndGoWindow: 90,
        climbWindow: 8,
        referenceValidRadius: 25_000
    )

    static let presets: [DetectionProfile] = [glider, ultralight, pistonSingle, turbine]

    static let `default` = pistonSingle
}
