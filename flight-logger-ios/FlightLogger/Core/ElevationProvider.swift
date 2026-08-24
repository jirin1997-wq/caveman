import Foundation

/// Terrain elevation under the aircraft, from whatever source can answer.
///
/// Ordering matters more than any single source. In flight there is usually no
/// signal, so anything that depends on the network is a bonus, never the plan:
///
/// 1. **Ground reference** — the median GPS altitude recorded while the
///    aircraft actually sat on the ground. Same receiver, same bias, same spot:
///    for the airfield you departed from this beats every map on earth.
/// 2. **Airport database** — published field elevation, offline.
/// 3. **Cache** — an online answer fetched earlier for this grid square.
/// 4. **Online** — Open-Meteo, asked in the background and written to the cache
///    for the next fix. Never blocks detection.
///
/// If all four come up empty the detector is told so and falls back to speed
/// and climb rate, tagging its events `.low` confidence.
@MainActor
final class CombinedElevationProvider {

    struct GroundReference: Codable, Equatable, Sendable {
        var coordinate: Coordinate
        var meters: Double
        var time: Date
        var sampleCount: Int
    }

    /// Within this distance the ground reference is the best number we have.
    var nearFieldRadius: Double = 2_000
    /// Beyond this it is not used at all.
    var validRadius: Double = 15_000
    /// A reference older than this belongs to a different day and a different
    /// pressure/ionosphere; drop it.
    var maxReferenceAge: TimeInterval = 12 * 3600
    /// Set false to keep the app fully offline.
    var useOnline: Bool = true

    private(set) var groundReference: GroundReference?
    private(set) var lastSample: ElevationSample?

    private let airports: AirportDatabase
    private let cache: ElevationCache
    private let online: OnlineElevationClient

    /// Stationary altitude samples waiting to become a reference.
    private var stationaryAltitudes: [Double] = []
    private var stationaryCoordinate: Coordinate?
    private var stationaryStart: Date?

    private var lastRequestCoordinate: Coordinate?
    private var lastRequestTime: Date?
    private var inFlightRequest = false
    private var lastFlush: Date = .distantPast

    /// A reference needs at least this many stationary samples and this much
    /// time — one fix while parked can be a wild outlier.
    private let minStationarySamples = 5
    private let minStationaryDuration: TimeInterval = 8

    init(airports: AirportDatabase, cache: ElevationCache, online: OnlineElevationClient = OnlineElevationClient()) {
        self.airports = airports
        self.cache = cache
        self.online = online
    }

    // MARK: - Ground reference

    /// Call for every fix where the aircraft is slow and known not to be
    /// airborne. Uses a median so one bad altitude cannot poison the reference.
    func noteGroundSample(_ fix: Fix) {
        guard fix.hasUsableAltitude, fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 30 else { return }

        // Moved to a different part of the airfield (or a different airfield):
        // start a fresh run rather than mixing altitudes from both.
        if let anchor = stationaryCoordinate, GeoMath.distance(anchor, fix.coordinate) > 500 {
            stationaryAltitudes.removeAll()
            stationaryStart = nil
        }
        stationaryCoordinate = fix.coordinate
        if stationaryStart == nil { stationaryStart = fix.timestamp }
        stationaryAltitudes.append(fix.altitude)
        if stationaryAltitudes.count > 60 { stationaryAltitudes.removeFirst() }

        guard stationaryAltitudes.count >= minStationarySamples,
              let start = stationaryStart,
              fix.timestamp.timeIntervalSince(start) >= minStationaryDuration,
              let median = GeoMath.median(stationaryAltitudes) else { return }

        groundReference = GroundReference(
            coordinate: fix.coordinate,
            meters: median,
            time: fix.timestamp,
            sampleCount: stationaryAltitudes.count
        )
    }

    /// Once the aircraft is flying, the run of stationary samples is over.
    func endGroundRun() {
        stationaryAltitudes.removeAll()
        stationaryStart = nil
    }

    func clearGroundReference() {
        groundReference = nil
        endGroundRun()
    }

    func restore(groundReference reference: GroundReference?) {
        groundReference = reference
    }

    // MARK: - Lookup

    /// Synchronous best answer available right now. Never blocks on the network.
    func bestEffort(at coordinate: Coordinate, now: Date = Date()) -> ElevationSample? {
        var reference: (sample: ElevationSample, distance: Double)?
        if let ref = groundReference, now.timeIntervalSince(ref.time) <= maxReferenceAge {
            let d = GeoMath.distance(ref.coordinate, coordinate)
            if d <= validRadius {
                reference = (ElevationSample(meters: ref.meters, source: .groundReference), d)
            }
        }

        // Close to where we were parked: nothing beats the receiver's own
        // reading of that exact spot.
        if let reference, reference.distance <= nearFieldRadius {
            lastSample = reference.sample
            return reference.sample
        }

        if let field = airports.elevation(at: coordinate) {
            lastSample = field
            return field
        }
        if let cached = cache.elevation(at: coordinate) {
            lastSample = cached
            return cached
        }
        // Away from the field with no map data: the departure elevation is a
        // rough answer, but a rough answer beats no AGL at all. The event
        // confidence drops accordingly.
        if let reference {
            lastSample = reference.sample
            return reference.sample
        }
        lastSample = nil
        return nil
    }

    /// Kicks off a background lookup for this position so the next fix can be
    /// answered from cache. Throttled by distance and time.
    func prefetch(around coordinate: Coordinate, now: Date = Date()) {
        guard useOnline, !inFlightRequest else { return }
        guard cache.elevation(at: coordinate) == nil else { return }
        if let last = lastRequestCoordinate, GeoMath.distance(last, coordinate) < 400,
           let t = lastRequestTime, now.timeIntervalSince(t) < 30 {
            return
        }
        lastRequestCoordinate = coordinate
        lastRequestTime = now
        inFlightRequest = true

        // Task inherits the main actor here, so the cache and the flags are
        // touched on the same actor that owns them.
        Task { @MainActor in
            let meters = await online.elevation(at: coordinate)
            inFlightRequest = false
            guard let meters else { return }
            cache.store(meters, at: coordinate)
            let stamp = Date()
            if stamp.timeIntervalSince(lastFlush) > 60 {
                lastFlush = stamp
                cache.flush()
            }
        }
    }

    func flush() {
        cache.flush()
    }

    var cachedTileCount: Int { cache.count }

    func nearestAirport(to coordinate: Coordinate) -> Airport? {
        airports.nearest(to: coordinate)?.airport
    }
}
