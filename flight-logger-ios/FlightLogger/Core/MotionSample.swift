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


/// Barometric vertical speed from successive relative-altitude readings.
///
/// Pulled out of `MotionService` so it can be tested: the CoreMotion adapter
/// around it has no logic left to get wrong, and the two rules that matter here
/// are easy to state and easy to break. A reading that arrives after a long
/// stall says nothing about the current climb — dividing a metre of drift by
/// half a second of assumed gap would invent a rate the aircraft never had.
struct BaroRate: Equatable, Sendable {

    /// Readings closer together than this are noise; further apart, the
    /// barometer stalled and the pair no longer describes one climb.
    var minInterval: TimeInterval = 0.2
    var maxInterval: TimeInterval = 10

    /// A light exponential smoothing. The sensor is quiet enough that a heavy
    /// filter would only add lag to the signal that has to stay responsive.
    var smoothing = 0.4

    private(set) var rate: Double?
    private var last: (altitude: Double, time: Date)?

    mutating func note(_ meters: Double, at time: Date) {
        defer { last = (meters, time) }
        guard let previous = last else { return }
        let dt = time.timeIntervalSince(previous.time)
        guard dt >= minInterval, dt <= maxInterval else { return }
        let raw = (meters - previous.altitude) / dt
        rate = rate.map { $0 + (raw - $0) * smoothing } ?? raw
    }

    mutating func reset() {
        rate = nil
        last = nil
    }
}

/// A short rolling window of acceleration magnitudes.
///
/// The mean says whether the aircraft is being accelerated; the standard
/// deviation says whether it is vibrating, which is the difference between a
/// running aircraft and a parked one.
struct MotionWindow: Equatable, Sendable {

    private(set) var values: [Double] = []

    /// Roughly two seconds at 10 Hz — long enough to average out a pothole,
    /// short enough to notice the moment power comes on.
    var capacity: Int = 20

    mutating func append(_ magnitude: Double) {
        values.append(magnitude)
        if values.count > capacity { values.removeFirst(values.count - capacity) }
    }

    mutating func reset() { values.removeAll() }

    var isEmpty: Bool { values.isEmpty }

    var mean: Double? {
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    var deviation: Double? {
        guard let mean, !values.isEmpty else { return nil }
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count)
        return variance.squareRoot()
    }
}
