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

    /// Taxi out, roll, climb, cruise, descend, land, taxi in.
    /// Roughly a 12-minute local flight.
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
                .init(duration: 90, speed: Units.knotsToMps(8)),                                    // taxi out
                .init(duration: 15, speedFrom: Units.knotsToMps(8), speedTo: Units.knotsToMps(65)), // roll
                .init(duration: 20, speedFrom: Units.knotsToMps(65), speedTo: Units.knotsToMps(75),
                      climbFrom: 1, climbTo: 4),                                                    // rotate
                .init(duration: 150, speed: Units.knotsToMps(80), climb: 4),                        // climb
                .init(duration: 240, speed: Units.knotsToMps(100)),                                 // cruise
                .init(duration: 200, speed: Units.knotsToMps(85), climb: -3),                       // descent
                .init(duration: 30, speedFrom: Units.knotsToMps(70), speedTo: Units.knotsToMps(55),
                      climbFrom: -3, climbTo: 0),                                                   // flare
                .init(duration: 25, speedFrom: Units.knotsToMps(55), speedTo: Units.knotsToMps(8)), // rollout
                .init(duration: 90, speed: Units.knotsToMps(8))                                     // taxi in
            ]
        )
    }

    /// Departure, one circuit, touch-and-go, second circuit, full stop.
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
                .init(duration: 60, speed: Units.knotsToMps(8)),
                .init(duration: 15, speedFrom: Units.knotsToMps(8), speedTo: Units.knotsToMps(65)),
                .init(duration: 20, speedFrom: Units.knotsToMps(65), speedTo: Units.knotsToMps(75),
                      climbFrom: 1, climbTo: 4),
                .init(duration: 90, speed: Units.knotsToMps(80), climb: 3),
                .init(duration: 120, speed: Units.knotsToMps(90)),
                .init(duration: 100, speed: Units.knotsToMps(80), climb: -3),
                .init(duration: 25, speedFrom: Units.knotsToMps(70), speedTo: Units.knotsToMps(55),
                      climbFrom: -1.2, climbTo: 0),
                // Wheels on the runway for 15 s, then straight back into it.
                .init(duration: 15, speed: Units.knotsToMps(40)),
                .init(duration: 15, speedFrom: Units.knotsToMps(40), speedTo: Units.knotsToMps(70),
                      climbFrom: 0, climbTo: 3),
                .init(duration: 90, speed: Units.knotsToMps(80), climb: 3),
                .init(duration: 120, speed: Units.knotsToMps(90)),
                .init(duration: 90, speed: Units.knotsToMps(80), climb: -3),
                .init(duration: 25, speedFrom: Units.knotsToMps(70), speedTo: Units.knotsToMps(55),
                      climbFrom: -1.8, climbTo: 0),
                .init(duration: 25, speedFrom: Units.knotsToMps(55), speedTo: Units.knotsToMps(8)),
                .init(duration: 60, speed: Units.knotsToMps(8))
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
                .init(duration: 60, speed: Units.knotsToMps(10))
            ]
        )
    }
}
