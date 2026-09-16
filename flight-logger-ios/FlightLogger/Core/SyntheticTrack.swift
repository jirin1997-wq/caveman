import Foundation

/// Deterministic fake GPS tracks.
///
/// Two uses: the unit tests replay them through `FlightDetector`, and the app's
/// own simulator (Settings → Simulace letu) feeds one through the real recorder
/// so the whole pipeline can be watched working while sitting at a desk.
enum SyntheticTrack {

    /// One leg of a flight. Speed and climb rate ramp linearly across the leg,
    /// which is close enough to a real takeoff roll or flare for detection work.
    struct Segment {
        var duration: TimeInterval
        var speedFrom: Double
        var speedTo: Double
        var climbFrom: Double
        var climbTo: Double
        var heading: Double

        init(
            duration: TimeInterval,
            speed: Double,
            climb: Double = 0,
            heading: Double = 90
        ) {
            self.duration = duration
            self.speedFrom = speed
            self.speedTo = speed
            self.climbFrom = climb
            self.climbTo = climb
            self.heading = heading
        }

        init(
            duration: TimeInterval,
            speedFrom: Double,
            speedTo: Double,
            climbFrom: Double = 0,
            climbTo: Double = 0,
            heading: Double = 90
        ) {
            self.duration = duration
            self.speedFrom = speedFrom
            self.speedTo = speedTo
            self.climbFrom = climbFrom
            self.climbTo = climbTo
            self.heading = heading
        }
    }

    /// Reproducible pseudo-random noise. A fixed seed keeps the tests from
    /// going flaky the way a real RNG would.
    private struct Noise {
        var state: UInt64
        mutating func next() -> Double {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            let bits = Double((state >> 11) & 0x1F_FFFF_FFFF_FFFF)
            return bits / Double(0x20_0000_0000_0000) * 2 - 1  // -1…1
        }
    }

    /// Renders segments into 1 Hz fixes.
    ///
    /// - Parameters:
    ///   - horizontalNoise: peak horizontal jitter in meters.
    ///   - verticalNoise: peak altitude jitter in meters. GPS altitude is the
    ///     noisy one — roughly 1.5× the horizontal error — which is exactly why
    ///     the detector regresses climb rate over a window instead of
    ///     differencing two fixes.
    static func make(
        origin: Coordinate,
        startAltitude: Double,
        start: Date,
        segments: [Segment],
        horizontalNoise: Double = 3,
        verticalNoise: Double = 4,
        seed: UInt64 = 42,
        reportSpeed: Bool = true
    ) -> [Fix] {
        var fixes: [Fix] = []
        var position = origin
        var altitude = startAltitude
        var time = start
        var noise = Noise(state: seed)

        for segment in segments {
            let steps = max(1, Int(segment.duration.rounded()))
            for step in 0..<steps {
                let t = steps <= 1 ? 0 : Double(step) / Double(steps - 1)
                let speed = segment.speedFrom + (segment.speedTo - segment.speedFrom) * t
                let climb = segment.climbFrom + (segment.climbTo - segment.climbFrom) * t

                let radians = segment.heading * .pi / 180
                position = GeoMath.offset(
                    position,
                    north: speed * cos(radians),
                    east: speed * sin(radians)
                )
                altitude += climb

                fixes.append(
                    Fix(
                        timestamp: time,
                        latitude: position.latitude + noise.next() * horizontalNoise / 111_000,
                        longitude: position.longitude + noise.next() * horizontalNoise / 111_000,
                        altitude: altitude + noise.next() * verticalNoise,
                        speed: reportSpeed ? max(0, speed + noise.next() * 0.5) : -1,
                        course: segment.heading,
                        horizontalAccuracy: 5,
                        verticalAccuracy: 8
                    )
                )
                time = time.addingTimeInterval(1)
            }
        }
        return fixes
    }

    // MARK: - Presets

    /// A local flight: taxi out, roll, climb out, a circuit away from the
    /// field, back down the reciprocal, land, taxi in, park.
    ///
    /// The headings matter. An earlier version flew due east the whole time and
    /// "landed" twenty kilometres from where it departed — which the logbook
    /// then reported as a return to the same field, and which the app's own
    /// airfield learning would have recorded as two different places. The legs
    /// below close the circuit: the aircraft parks within half a kilometre of
    /// where it started.
    static func standardFlight(
        origin: Coordinate = Coordinate(latitude: 49.9, longitude: 15.0),
        fieldElevation: Double = 250,
        start: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> [Fix] {
        make(
            origin: origin,
            startAltitude: fieldElevation,
            start: start,
            segments: [
                .init(duration: 90, speed: Units.knotsToMps(8), heading: 90),                        // taxi out
                .init(duration: 15, speedFrom: Units.knotsToMps(8), speedTo: Units.knotsToMps(65),
                      heading: 90),                                                                  // roll
                .init(duration: 20, speedFrom: Units.knotsToMps(65), speedTo: Units.knotsToMps(75),
                      climbFrom: 1, climbTo: 4, heading: 90),                                        // rotate
                .init(duration: 150, speed: Units.knotsToMps(80), climb: 4, heading: 90),            // climb out
                .init(duration: 93, speed: Units.knotsToMps(100), heading: 90),                      // outbound
                .init(duration: 60, speed: Units.knotsToMps(100), heading: 0),                       // crosswind
                .init(duration: 87, speed: Units.knotsToMps(100), heading: 270),                     // inbound
                .init(duration: 140, speed: Units.knotsToMps(85), climb: -3, heading: 270),          // descent
                .init(duration: 60, speed: Units.knotsToMps(85), climb: -3, heading: 180),           // base
                .init(duration: 30, speedFrom: Units.knotsToMps(70), speedTo: Units.knotsToMps(55),
                      climbFrom: -3, climbTo: 0, heading: 270),                                      // final, flare
                .init(duration: 25, speedFrom: Units.knotsToMps(55), speedTo: Units.knotsToMps(8),
                      heading: 270),                                                                 // rollout
                .init(duration: 90, speed: Units.knotsToMps(8), heading: 270),                       // taxi in
                .init(duration: 60, speed: 0, heading: 270)                                          // parked
            ]
        )
    }

    /// Departure, one circuit, touch-and-go, second circuit, full stop.
    /// Both circuits close on the field, the same way a real one does.
    static func touchAndGo(
        origin: Coordinate = Coordinate(latitude: 49.9, longitude: 15.0),
        fieldElevation: Double = 250,
        start: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> [Fix] {
        make(
            origin: origin,
            startAltitude: fieldElevation,
            start: start,
            segments: [
                .init(duration: 60, speed: Units.knotsToMps(8), heading: 90),
                .init(duration: 15, speedFrom: Units.knotsToMps(8), speedTo: Units.knotsToMps(65),
                      heading: 90),
                .init(duration: 20, speedFrom: Units.knotsToMps(65), speedTo: Units.knotsToMps(75),
                      climbFrom: 1, climbTo: 4, heading: 90),
                .init(duration: 90, speed: Units.knotsToMps(80), climb: 3, heading: 90),
                .init(duration: 79, speed: Units.knotsToMps(90), heading: 0),                  // crosswind
                .init(duration: 41, speed: Units.knotsToMps(90), heading: 270),                // downwind
                .init(duration: 100, speed: Units.knotsToMps(80), climb: -3, heading: 270),
                .init(duration: 25, speedFrom: Units.knotsToMps(70), speedTo: Units.knotsToMps(55),
                      climbFrom: -1.2, climbTo: 0, heading: 90),                               // final
                // Wheels on the runway for 15 s, then straight back into it.
                .init(duration: 15, speed: Units.knotsToMps(40), heading: 90),
                .init(duration: 15, speedFrom: Units.knotsToMps(40), speedTo: Units.knotsToMps(70),
                      climbFrom: 0, climbTo: 3, heading: 90),
                .init(duration: 90, speed: Units.knotsToMps(80), climb: 3, heading: 90),
                .init(duration: 79, speed: Units.knotsToMps(90), heading: 180),                // crosswind
                .init(duration: 41, speed: Units.knotsToMps(90), heading: 270),                // downwind
                .init(duration: 90, speed: Units.knotsToMps(80), climb: -3, heading: 270),
                .init(duration: 25, speedFrom: Units.knotsToMps(70), speedTo: Units.knotsToMps(55),
                      climbFrom: -1.8, climbTo: 0, heading: 90),                               // final
                .init(duration: 25, speedFrom: Units.knotsToMps(55), speedTo: Units.knotsToMps(8),
                      heading: 90),
                .init(duration: 60, speed: Units.knotsToMps(8), heading: 90),
                .init(duration: 60, speed: 0, heading: 90)
            ]
        )
    }

    /// A fast taxi and a high-speed rejected takeoff — above the speed
    /// threshold, never off the ground. Nothing may be logged.
    static func fastTaxiNoTakeoff(
        origin: Coordinate = Coordinate(latitude: 49.9, longitude: 15.0),
        fieldElevation: Double = 250,
        start: Date = Date(timeIntervalSince1970: 1_700_000_000)
    ) -> [Fix] {
        make(
            origin: origin,
            startAltitude: fieldElevation,
            start: start,
            segments: [
                .init(duration: 60, speed: Units.knotsToMps(10)),
                .init(duration: 20, speedFrom: Units.knotsToMps(10), speedTo: Units.knotsToMps(60)),
                .init(duration: 30, speed: Units.knotsToMps(60)),   // above rotate speed, still rolling
                .init(duration: 25, speedFrom: Units.knotsToMps(60), speedTo: Units.knotsToMps(10)),
                .init(duration: 60, speed: Units.knotsToMps(10)),
                .init(duration: 60, speed: 0)
            ]
        )
    }
}
