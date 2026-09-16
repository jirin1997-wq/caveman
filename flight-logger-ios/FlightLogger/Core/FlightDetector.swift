import Foundation

/// Coarse phase, for the live screen.
enum FlightPhase: String, Codable, Sendable {
    case unknown
    case onGround
    /// Moving under its own power but not yet accelerating for departure.
    /// Block time is running.
    case taxi
    case takeoffRoll
    case airborne
    case approach

    var label: String {
        switch self {
        case .unknown: return "ČEKÁM NA GPS"
        case .onGround: return "NA ZEMI"
        case .taxi: return "POJÍŽDÍM"
        case .takeoffRoll: return "ROZJEZD"
        case .airborne: return "VE VZDUCHU"
        case .approach: return "PŘIBLÍŽENÍ"
        }
    }
}

/// What the live screen shows between events.
struct DetectorSnapshot: Sendable {
    var phase: FlightPhase = .unknown
    var speed: Double = -1
    var altitude: Double?
    var agl: Double?
    var climbRate: Double?
    var elevation: ElevationSample?
    /// 0…1 — how far the current takeoff/landing candidate is toward being
    /// confirmed. Drives the progress ring on the live screen.
    var candidateProgress: Double = 0
    var fixAge: TimeInterval?
}

/// Takeoff / landing detection.
///
/// The rule the app is built around: a state change needs **both** signals to
/// agree — ground speed crossing the aircraft's threshold **and** height above
/// the terrain underneath crossing its own. Altitude alone is useless (an
/// airfield at 600 m MSL is "high" all day); speed alone is useless (a fast taxi
/// or a car on the motorway looks like a departure). Together they are solid.
///
/// Two details do most of the work in practice:
///
/// 1. **Hysteresis + dwell.** Takeoff and landing use different speed
///    thresholds, and every condition must hold for `confirmDuration` before an
///    event is emitted. A gust or a single bad fix cannot flip the state.
/// 2. **Backdating.** The event is confirmed seconds after it happened, then
///    stamped at the actual transition found by walking back through the sample
///    buffer. The logbook shows wheels-off, not "five seconds after wheels-off".
///
/// Pure logic, no CoreLocation — see `FlightDetectorTests` for synthetic tracks.
final class FlightDetector {

    private struct Sample {
        var fix: Fix
        var speed: Double
        var agl: Double?
        var elevation: ElevationSample?
        var climbRate: Double?
        var motion: MotionSample?
        /// True when `agl` came from the barometer rather than from GPS
        /// altitude minus a terrain elevation.
        var aglIsBarometric = false
    }

    var profile: DetectionProfile

    private(set) var phase: FlightPhase = .unknown
    private(set) var snapshot = DetectorSnapshot()

    private var buffer: [Sample] = []
    private var lastFix: Fix?

    /// Timestamp of the first sample of the current candidate run, or nil when
    /// no candidate is in progress.
    private var airborneSince: Date?
    private var groundedSince: Date?
    /// Wheels on the runway without slowing down — see `looksTouchedDown`.
    private var touchSince: Date?

    /// Block state: is the aircraft moving under its own power? Independent of
    /// whether it is flying — block time spans taxi, flight and taxi again.
    private(set) var isMoving = false
    private var movingSince: Date?
    private var stoppedSince: Date?

    /// Guards against inventing an event for a transition we never saw: opening
    /// the app mid-flight must not log a takeoff.
    private var hasObservedGround = false
    private var hasObservedAir = false

    /// Longest history the backdating walk can reach into.
    private let bufferSpan: TimeInterval = 120
    /// Gap after which the receiver is assumed to have missed a transition.
    private let gapTimeout: TimeInterval = 60
    /// Dwell for the touch-and-go rule. Shorter than the full confirmation —
    /// the wheels are only down for a few seconds.
    private let touchConfirmDuration: TimeInterval = 3

    init(profile: DetectionProfile = .default) {
        self.profile = profile
    }

    func reset() {
        buffer.removeAll()
        lastFix = nil
        airborneSince = nil
        groundedSince = nil
        touchSince = nil
        movingSince = nil
        stoppedSince = nil
        isMoving = false
        hasObservedGround = false
        hasObservedAir = false
        phase = .unknown
        snapshot = DetectorSnapshot()
    }

    /// Feeds one fix through the state machine.
    ///
    /// - Parameter elevation: terrain elevation under the aircraft, from
    ///   `CombinedElevationProvider`. Nil is tolerated — the detector falls back
    ///   to speed and climb rate and marks its events `.low` confidence.
    /// - Parameter motion: what the phone's own sensors say, when they are
    ///   available. The barometer's height and climb rate are preferred over
    ///   anything derived from GPS altitude, which is far noisier. Passing nil
    ///   leaves behaviour exactly as it is without motion data.
    /// - Returns: events detected on this fix. Normally empty.
    @discardableResult
    func ingest(_ fix: Fix, elevation: ElevationSample?, motion: MotionSample? = nil) -> [FlightEvent] {
        guard isUsable(fix) else { return [] }

        if let last = lastFix {
            let dt = fix.timestamp.timeIntervalSince(last.timestamp)
            // Out of order or duplicate — the receiver does this after a signal
            // gap. Dropping is safer than fitting a line through time going
            // backwards.
            if dt <= 0 { return [] }
            if dt > gapTimeout {
                // Dark long enough that a whole circuit could have happened.
                // Start over rather than bridge the gap with a fabrication.
                buffer.removeAll()
                airborneSince = nil
                groundedSince = nil
                touchSince = nil
                // The block timers restart too, but `isMoving` stands: going
                // dark is no evidence the aircraft stopped.
                movingSince = nil
                stoppedSince = nil
                phase = .unknown
                // Forgetting what we saw is the point: it stops the next
                // confirmation from claiming a takeoff nobody watched.
                hasObservedGround = false
                hasObservedAir = false
            }
        }

        let speed = resolveSpeed(fix)
        lastFix = fix

        var sample = Sample(
            fix: fix, speed: speed, agl: nil,
            elevation: elevation, climbRate: nil, motion: motion
        )
        if let elevation, fix.hasUsableAltitude {
            sample.agl = fix.altitude - elevation.meters
        }
        // The barometer wins when it has a zero to measure from: centimetres of
        // relative precision against the GPS receiver's several metres.
        if let baro = motion?.baroAGL {
            sample.agl = baro
            sample.aglIsBarometric = true
        }

        buffer.append(sample)
        trimBuffer(now: fix.timestamp)
        sample.climbRate = motion?.climbRate ?? climbRate(at: fix.timestamp)
        buffer[buffer.count - 1] = sample

        if wasOnGround(sample), sample.speed <= profile.landingSpeed { hasObservedGround = true }
        if looksAirborne(sample) { hasObservedAir = true }

        var events = advance(with: sample)
        events.append(contentsOf: advanceBlocks(with: sample))
        updateSnapshot(with: sample)
        return events
    }

    // MARK: - State machine

    private func advance(with sample: Sample) -> [FlightEvent] {
        // The two criteria are mutually exclusive by construction: airborne
        // needs speed >= takeoffSpeed, grounded needs speed <= landingSpeed,
        // and takeoffSpeed is always the higher of the two. The gap between
        // them is the hysteresis band.
        if looksAirborne(sample) {
            if airborneSince == nil { airborneSince = sample.fix.timestamp }
        } else {
            airborneSince = nil
        }
        if looksGrounded(sample) {
            if groundedSince == nil { groundedSince = sample.fix.timestamp }
        } else {
            groundedSince = nil
        }
        if looksTouchedDown(sample) {
            if touchSince == nil { touchSince = sample.fix.timestamp }
        } else {
            touchSince = nil
        }

        switch phase {
        case .unknown:
            // Adopt whichever state holds first, but only call it an event if
            // we actually watched the transition. Launching the app at 3000 ft
            // must not write a takeoff into the logbook.
            if confirmed(airborneSince, at: sample) {
                phase = .airborne
                airborneSince = nil
                guard hasObservedGround else { return [] }
                return [makeEvent(kind: .takeoff, at: takeoffSampleIndex())]
            }
            if confirmed(groundedSince, at: sample) {
                phase = .onGround
                groundedSince = nil
                guard hasObservedAir else { return [] }
                return [makeEvent(kind: .landing, at: landingSampleIndex())]
            }
            return []

        case .onGround, .taxi, .takeoffRoll:
            guard confirmed(airborneSince, at: sample) else { return [] }
            phase = .airborne
            airborneSince = nil
            return [makeEvent(kind: .takeoff, at: takeoffSampleIndex())]

        case .airborne, .approach:
            if confirmed(groundedSince, at: sample) {
                phase = .onGround
                groundedSince = nil
                touchSince = nil
                return [makeEvent(kind: .landing, at: landingSampleIndex())]
            }
            // Touch-and-go: the wheels were on the runway but the aircraft
            // never slowed to taxi speed, so the primary rule never fires.
            if let since = touchSince,
               sample.fix.timestamp.timeIntervalSince(since) >= touchConfirmDuration {
                phase = .onGround
                groundedSince = nil
                touchSince = nil
                return [makeEvent(kind: .landing, at: landingSampleIndex())]
            }
            return []
        }
    }

    /// Off-blocks and on-blocks — the other pair of times a logbook wants.
    ///
    /// Flight time is wheels-off to wheels-on. Block time is the whole movement:
    /// from when the aircraft first rolls to when it finally stops, taxi
    /// included. They are different numbers and pilots log both, so the app
    /// detects both rather than making one up from the other.
    ///
    /// The stop needs a long dwell on purpose. Holding short of the runway,
    /// waiting for a landing aircraft, is not the end of a flight.
    private func advanceBlocks(with sample: Sample) -> [FlightEvent] {
        if sample.speed >= profile.movingSpeed {
            if movingSince == nil { movingSince = sample.fix.timestamp }
            stoppedSince = nil
        } else if sample.speed >= 0 && sample.speed <= profile.stoppedSpeed {
            if stoppedSince == nil { stoppedSince = sample.fix.timestamp }
            movingSince = nil
        } else {
            // The dead band between the two thresholds — the hysteresis that
            // keeps a wobbling GPS from toggling block time.
            movingSince = nil
            stoppedSince = nil
        }

        if !isMoving, let since = movingSince,
           sample.fix.timestamp.timeIntervalSince(since) >= profile.movingConfirm {
            isMoving = true
            movingSince = nil
            return [makeEvent(kind: .offBlocks, at: indexOfSample(atOrAfter: since))]
        }

        if isMoving, let since = stoppedSince,
           sample.fix.timestamp.timeIntervalSince(since) >= profile.stoppedConfirm {
            isMoving = false
            stoppedSince = nil
            return [makeEvent(kind: .onBlocks, at: indexOfSample(atOrAfter: since))]
        }

        return []
    }

    /// First buffered sample at or after a timestamp — how a block event gets
    /// backdated to the moment the aircraft actually started or stopped.
    private func indexOfSample(atOrAfter time: Date) -> Int {
        buffer.firstIndex { $0.fix.timestamp >= time } ?? max(0, buffer.count - 1)
    }

    private func confirmed(_ since: Date?, at sample: Sample) -> Bool {
        guard let since else { return false }
        return sample.fix.timestamp.timeIntervalSince(since) >= profile.confirmDuration
    }

    // MARK: - Criteria

    /// Both signals must agree. With a known AGL the speed threshold plus a
    /// clear height above the terrain is enough; between `groundAGL` and
    /// `airborneAGL` (the rotation band) a positive climb is also required.
    /// Without AGL we are down to speed plus climb rate, which is why those
    /// events are tagged `.low`.
    private func looksAirborne(_ s: Sample) -> Bool {
        let fastEnough = s.speed >= profile.takeoffSpeed
        guard fastEnough else { return false }
        let climbing = (s.climbRate ?? 0) >= profile.climbRate
        if let agl = s.agl {
            return agl >= profile.airborneAGL || (agl >= profile.groundAGL && climbing)
        }
        return climbing
    }

    /// Landing needs low **and** slow. Height alone would log a low pass at 100
    /// kt as a landing; speed alone would log a slow thermalling turn as one.
    private func looksGrounded(_ s: Sample) -> Bool {
        let slowEnough = s.speed <= profile.landingSpeed
        if let agl = s.agl {
            return agl <= profile.groundAGL && slowEnough
        }
        let level = abs(s.climbRate ?? 0) <= profile.climbRate
        return slowEnough && level
    }

    /// Wheels down without slowing down.
    ///
    /// A full-stop landing is caught by `looksGrounded`; a touch-and-go is not,
    /// because the aircraft goes round again at 40 kt and never reaches taxi
    /// speed. The evidence here is weaker — height alone, with the descent
    /// arrested — so it demands a much lower AGL, half the ground threshold.
    /// The one thing it can mistake for a landing is a low pass flown below
    /// ~30 ft AGL, which is rare enough to be worth the trade.
    private func looksTouchedDown(_ s: Sample) -> Bool {
        guard let agl = s.agl else { return false }
        return agl <= profile.groundAGL * 0.5 && abs(s.climbRate ?? 0) <= profile.climbRate
    }

    /// Height test only — used to walk back to the moment of transition, where
    /// speed is still high (rollout) or already high (rotation).
    private func wasOnGround(_ s: Sample) -> Bool {
        if let agl = s.agl { return agl <= profile.groundAGL }
        return s.speed <= profile.landingSpeed
    }

    // MARK: - Backdating

    /// Index of the first airborne sample of the current run: walk back from the
    /// newest sample while it still looks off the ground.
    private func takeoffSampleIndex() -> Int {
        var idx = buffer.count - 1
        while idx > 0 && !wasOnGround(buffer[idx - 1]) {
            idx -= 1
        }
        return idx
    }

    /// Index of the first grounded sample of the current run — the touchdown.
    private func landingSampleIndex() -> Int {
        var idx = buffer.count - 1
        while idx > 0 && wasOnGround(buffer[idx - 1]) {
            idx -= 1
        }
        return idx
    }

    private func makeEvent(kind: FlightEventKind, at index: Int) -> FlightEvent {
        let s = buffer[max(0, min(index, buffer.count - 1))]
        let source = s.elevation?.source ?? .unavailable
        // A barometric height is measured against the surface the aircraft was
        // standing on, by a sensor an order of magnitude quieter than GPS
        // altitude. It does not depend on the terrain lookup at all.
        let confidence = s.aglIsBarometric
            ? EventConfidence.high
            : EventConfidence.forTerrain(s.elevation, agl: s.agl)
        return FlightEvent(
            kind: kind,
            time: s.fix.timestamp,
            latitude: s.fix.latitude,
            longitude: s.fix.longitude,
            altitude: s.fix.altitude,
            agl: s.agl,
            groundElevation: s.elevation?.meters,
            elevationSource: source,
            speed: s.speed,
            confidence: confidence,
            airport: nil
        )
    }

    // MARK: - Signals

    private func isUsable(_ fix: Fix) -> Bool {
        fix.horizontalAccuracy >= 0 && fix.horizontalAccuracy <= profile.maxHorizontalAccuracy
    }

    /// Receivers report -1 for speed when they cannot compute it; derive it from
    /// the previous fix in that case rather than dropping the sample.
    private func resolveSpeed(_ fix: Fix) -> Double {
        if fix.speed >= 0 { return fix.speed }
        guard let last = lastFix else { return 0 }
        let dt = fix.timestamp.timeIntervalSince(last.timestamp)
        guard dt > 0 else { return 0 }
        return GeoMath.distance(last.coordinate, fix.coordinate) / dt
    }

    /// Least-squares slope of altitude over the last `climbWindow` seconds.
    /// Differencing two fixes would mostly measure GPS vertical noise.
    private func climbRate(at now: Date) -> Double? {
        let window = buffer.filter {
            now.timeIntervalSince($0.fix.timestamp) <= profile.climbWindow && $0.fix.hasUsableAltitude
        }
        guard window.count >= 3 else { return nil }
        let span = window.last!.fix.timestamp.timeIntervalSince(window.first!.fix.timestamp)
        guard span >= profile.climbWindow * 0.5 else { return nil }
        let x = window.map { $0.fix.timestamp.timeIntervalSince1970 }
        let y = window.map { $0.fix.altitude }
        return GeoMath.slope(x: x, y: y)
    }

    private func trimBuffer(now: Date) {
        while let first = buffer.first, now.timeIntervalSince(first.fix.timestamp) > bufferSpan {
            buffer.removeFirst()
        }
    }

    private func updateSnapshot(with s: Sample) {
        var display = phase
        if phase == .onGround, isMoving { display = .taxi }
        if phase == .onGround || phase == .unknown, airborneSince != nil { display = .takeoffRoll }
        if phase == .airborne, groundedSince != nil { display = .approach }
        if phase == .unknown, airborneSince == nil { display = .unknown }

        // Only a candidate that could actually change the state counts. In
        // cruise `airborneSince` is re-armed on every fix — it is simply still
        // true that the aircraft is flying — and reporting that as pending
        // would leave the live screen claiming to be verifying a change for the
        // whole flight.
        let pending: Date?
        switch phase {
        case .unknown:
            pending = airborneSince ?? groundedSince
        case .onGround, .taxi, .takeoffRoll:
            pending = airborneSince
        case .airborne, .approach:
            pending = groundedSince ?? touchSince
        }

        var progress = 0.0
        if let pending {
            progress = min(1, s.fix.timestamp.timeIntervalSince(pending) / profile.confirmDuration)
        }

        snapshot = DetectorSnapshot(
            phase: display,
            speed: s.speed,
            altitude: s.fix.hasUsableAltitude ? s.fix.altitude : nil,
            agl: s.agl,
            climbRate: s.climbRate,
            elevation: s.elevation,
            candidateProgress: progress,
            fixAge: Date().timeIntervalSince(s.fix.timestamp)
        )
    }
}
