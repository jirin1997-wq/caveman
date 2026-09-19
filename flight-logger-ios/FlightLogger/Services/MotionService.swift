import CoreMotion
import Foundation

/// The phone's own motion sensors, turned into a `MotionSample` per fix.
///
/// Both sensors are optional in every sense: an older device may have no
/// barometer, the user may refuse motion access, and the app must keep
/// detecting flights either way. Everything here fails silently to nil.
@MainActor
final class MotionService: ObservableObject {

    @Published private(set) var sample = MotionSample()
    @Published private(set) var isRunning = false

    /// True when the device can measure pressure at all — the sensor that
    /// actually improves detection.
    let hasBarometer = CMAltimeter.isRelativeAltitudeAvailable()

    private let altimeter = CMAltimeter()
    private let motion = CMMotionManager()

    private var baro = BaroReference()
    private var rate = BaroRate()
    private var accel = MotionWindow()
    private var lastReading: (altitude: Double, time: Date)?

    var hasMotion: Bool { motion.isDeviceMotionAvailable }

    // MARK: - Lifecycle

    func start() {
        guard !isRunning else { return }
        isRunning = true

        if hasBarometer {
            altimeter.startRelativeAltitudeUpdates(to: .main) { [weak self] data, _ in
                guard let data else { return }
                MainActor.assumeIsolated {
                    self?.handleBaro(meters: data.relativeAltitude.doubleValue, at: Date())
                }
            }
        }

        if motion.isDeviceMotionAvailable {
            motion.deviceMotionUpdateInterval = 0.1
            motion.startDeviceMotionUpdates(to: .main) { [weak self] data, _ in
                guard let data else { return }
                let a = data.userAcceleration
                // Magnitude with gravity already removed. Orientation
                // independent, which is the only honest thing to read from a
                // phone whose mounting nobody knows.
                let magnitude = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
                MainActor.assumeIsolated {
                    self?.handleAcceleration(magnitude)
                }
            }
        }
    }

    func stop() {
        guard isRunning else { return }
        altimeter.stopRelativeAltitudeUpdates()
        motion.stopDeviceMotionUpdates()
        isRunning = false
        lastReading = nil
        rate.reset()
        accel.reset()
        sample = MotionSample()
    }

    // MARK: - Ground reference

    /// Call for every fix where the aircraft is on the surface. Re-zeroing on
    /// each ground contact is what keeps the barometer honest across a day of
    /// changing pressure.
    func noteGroundContact(at time: Date = Date()) {
        guard let reading = lastReading else { return }
        baro.noteGroundReading(reading.altitude, at: time)
        refreshSample()
    }

    func endGroundRun() {
        baro.endGroundRun()
    }

    func resetReference() {
        baro.reset()
        refreshSample()
    }

    var baroZeroed: Bool { baro.zero != nil }

    // MARK: - Sensor handlers

    private func handleBaro(meters: Double, at time: Date) {
        rate.note(meters, at: time)
        lastReading = (meters, time)
        refreshSample()
    }

    private func handleAcceleration(_ magnitude: Double) {
        accel.append(magnitude)
        refreshSample()
    }

    private func refreshSample() {
        var next = MotionSample()
        if let reading = lastReading {
            next.baroAGL = baro.height(for: reading.altitude, at: reading.time)
            next.climbRate = rate.rate
        }
        next.acceleration = accel.mean
        next.vibration = accel.deviation
        if next != sample { sample = next }
    }
}
