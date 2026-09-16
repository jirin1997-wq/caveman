import Foundation

/// What the phone's own motion sensors contribute, alongside the GPS fix.
///
/// Two very different sensors, and they are worth very different amounts here.
///
/// **The barometer does the heavy lifting.** GPS altitude is the noisiest thing
/// a receiver reports — ±8 m is a good day, and the detector has to regress it
/// over six seconds just to get a usable climb rate. The iPhone's pressure
/// sensor resolves *relative* height to a few centimetres and updates about
/// once a second. It cannot tell you your altitude above the sea, but that is
/// not what this app asks it: zero it on the ground and it answers "how far
/// above that spot am I" better than any other source on the device.
///
/// **The accelerometer corroborates.** A phone loose in a pocket has no known
/// orientation, so there is no honest way to read forward acceleration from it —
/// only the magnitude of specific force, which is orientation-independent. That
/// is still worth having: it says the aircraft is under power and moving, which
/// the live screen shows, and it is what stops a fix taken during a bouncing
/// grass-strip roll from being mistaken for the aircraft standing still.
struct MotionSample: Equatable, Sendable {

    /// Height above the point where the barometer was zeroed, meters.
    /// Nil until the app has had the aircraft on the ground with the
    /// barometer running.
    var baroAGL: Double?

    /// Barometric vertical speed, m/s. Cleaner than anything derived from GPS.
    var climbRate: Double?

    /// Magnitude of acceleration with gravity removed, in g. Orientation
    /// independent, so it survives the phone being in a pocket.
    var acceleration: Double?

    /// Short-window variability of that magnitude — engine and airframe
    /// vibration. High on a running aircraft, near zero on a parked one.
    var vibration: Double?

    /// Acceleration above which the phone is being moved about too hard for the
    /// fix to describe a stationary aircraft.
    static let restingAcceleration = 0.35

    /// False when no sensor reported anything — the detector then behaves
    /// exactly as it does on a device with no motion data at all.
    var hasData: Bool {
        baroAGL != nil || climbRate != nil || acceleration != nil
    }

    var isPlausiblyAtRest: Bool {
        guard let acceleration else { return true }
        return acceleration <= Self.restingAcceleration
    }
}

/// Turns the barometer's relative altitude into a height above the surface.
///
/// `CMAltimeter` reports metres relative to wherever it happened to start, so
/// the number means nothing on its own. Zeroing it every time the aircraft is
/// on the ground turns it into exactly what the detector wants — and re-zeroing
/// on each ground contact is also what keeps slow weather drift (roughly a
/// hPa an hour, about 8 m) from ever accumulating.
struct BaroReference: Equatable, Sendable {

    /// The relative altitude the barometer reported while on the ground.
    private(set) var zero: Double?
    private(set) var takenAt: Date?

    /// Samples are median-filtered like the GPS ground reference, for the same
    /// reason: one bad reading must not move it.
    private var samples: [Double] = []

    /// After this long the reference belongs to a different weather situation.
    var maxAge: TimeInterval = 4 * 3600

    private let minSamples = 4

    /// Feed every barometer reading taken while the aircraft is on the surface.
    mutating func noteGroundReading(_ relativeAltitude: Double, at time: Date) {
        samples.append(relativeAltitude)
        if samples.count > 40 { samples.removeFirst() }
        guard samples.count >= minSamples, let median = GeoMath.median(samples) else { return }
        zero = median
        takenAt = time
    }

    /// Call once the aircraft is flying: the run of ground readings is over.
    mutating func endGroundRun() {
        samples.removeAll()
    }

    mutating func reset() {
        samples.removeAll()
        zero = nil
        takenAt = nil
    }

    /// Height above the zeroed surface, or nil when there is no usable zero.
    func height(for relativeAltitude: Double, at time: Date) -> Double? {
        guard let zero, let takenAt, time.timeIntervalSince(takenAt) <= maxAge else { return nil }
        return relativeAltitude - zero
    }
}
