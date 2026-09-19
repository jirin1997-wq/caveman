import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// Ties the pieces together: fixes in, logbook entries out.
///
///     LocationService ──Fix──▶ FlightRecorder ──▶ FlightDetector ──FlightEvent──▶ FlightStore
///                                    │
///                                    └──▶ CombinedElevationProvider (terrain under the aircraft)
@MainActor
final class FlightRecorder: ObservableObject {

    @Published private(set) var snapshot = DetectorSnapshot()
    @Published private(set) var currentFlight: Flight?
    @Published private(set) var lastEvent: FlightEvent?
    @Published private(set) var isRecording = false
    @Published private(set) var isSimulating = false
    /// Terrain elevation currently in use, surfaced so the pilot can see
    /// whether AGL is trustworthy.
    @Published private(set) var elevation: ElevationSample?

    /// The track as it is being recorded, thinned for drawing. Drives the live
    /// map and the live graph; the full-resolution track still goes to disk.
    @Published private(set) var liveTrack = TrackBuffer()
    /// What the phone's own sensors are contributing right now.
    @Published private(set) var motion = MotionSample()

    let store: FlightStore
    let settings: AppSettings
    let location: LocationService
    let elevationProvider: CombinedElevationProvider
    let motionService: MotionService

    private let detector: FlightDetector
    let airports: AirportDatabase

    private var pendingTrack: [TrackPoint] = []
    private var lastTrackFlush = Date.distantPast
    private var lastTrackPoint: TrackPoint?
    private var lastReferencePersist = Date.distantPast
    private var simulationTask: Task<Void, Never>?

    /// One track point per second is plenty; a receiver that reports faster
    /// would otherwise triple the file size for no extra detail.
    private let trackInterval: TimeInterval = 1
    private let trackFlushInterval: TimeInterval = 20

    /// An off-blocks seen before a takeoff, waiting for the flight it belongs to.
    private var pendingOffBlocks: FlightEvent?

    init(
        store: FlightStore,
        settings: AppSettings,
        location: LocationService = LocationService(),
        motionService: MotionService = MotionService()
    ) {
        self.store = store
        self.settings = settings
        self.location = location
        self.motionService = motionService
        // Held in a local first: Swift will not let an initializer read back a
        // stored property until every one of them has a value.
        let airports = AirportDatabase.loadDefault(userDirectory: AppPaths.root)
        self.airports = airports
        self.elevationProvider = CombinedElevationProvider(
            airports: airports,
            cache: ElevationCache(directory: AppPaths.root)
        )
        self.detector = FlightDetector(profile: settings.profile)

        elevationProvider.useOnline = settings.useOnlineElevation
        elevationProvider.restore(groundReference: settings.groundReference)
        // A flight left open by a crash or a force-quit is picked back up, so
        // its landing still closes the right entry.
        currentFlight = store.openFlight

        self.location.onFix = { [weak self] fix in
            self?.ingest(fix)
        }
    }

    // MARK: - Lifecycle

    func start() {
        detector.profile = settings.profile
        elevationProvider.useOnline = settings.useOnlineElevation
        location.start()
        motionService.start()
        liveTrack.reset()
        isRecording = location.isRunning
        applyIdleTimer()
    }

    func stop() {
        location.stop()
        motionService.stop()
        isRecording = false
        flushTrack(force: true)
        elevationProvider.flush()
        applyIdleTimer()
    }

    func applySettings() {
        detector.profile = settings.profile
        elevationProvider.useOnline = settings.useOnlineElevation
        applyIdleTimer()
    }

    private func applyIdleTimer() {
        #if canImport(UIKit)
        UIApplication.shared.isIdleTimerDisabled = settings.keepScreenAwake && (isRecording || isSimulating)
        #endif
    }

    // MARK: - Fix pipeline

    func ingest(_ fix: Fix) {
        let sample = elevationProvider.bestEffort(at: fix.coordinate, now: fix.timestamp)
        elevation = sample

        let motionSample = motionService.sample
        motion = motionSample
        let events = detector.ingest(
            fix,
            elevation: sample,
            motion: motionSample.hasData ? motionSample : nil
        )
        snapshot = detector.snapshot

        // Terrain reference: while the aircraft is on the surface and moving no
        // faster than taxi speed. See `acceptsGroundSample` for why "on the
        // surface" is the test rather than "stopped".
        if detector.profile.acceptsGroundSample(
            phase: detector.phase,
            speed: snapshot.speed,
            agl: snapshot.agl,
            motion: motionSample.hasData ? motionSample : nil
        ) {
            elevationProvider.noteGroundSample(fix)
            // Same moment, same reason: zero the barometer against the surface
            // the aircraft is standing on.
            motionService.noteGroundContact(at: fix.timestamp)
            persistGroundReferenceIfWorthwhile(now: fix.timestamp)
            // Parked at a strip the app learned but has no elevation for yet:
            // this is the moment it can measure one. Next visit to that field
            // has AGL from the first fix, before the aircraft even moves.
            if let reference = elevationProvider.groundReference {
                airports.noteMeasuredElevation(reference.meters, at: fix.coordinate)
            }
        } else if detector.phase == .airborne {
            elevationProvider.endGroundRun()
            motionService.endGroundRun()
        }

        elevationProvider.prefetch(around: fix.coordinate, now: fix.timestamp)

        for event in events {
            handle(event)
        }

        recordTrackPoint(fix: fix, agl: snapshot.agl, speed: snapshot.speed, vs: snapshot.climbRate)
    }

    /// Names the place an event happened.
    ///
    /// A dataset only ever covers some airfields; LKHN and every farm strip are
    /// not in one. So an event somewhere unknown creates a learned airfield on
    /// the spot, with the elevation measured on the ground if there is one. The
    /// pilot renames it once and the logbook knows that field from then on.
    private func resolveAirfield(for event: FlightEvent) -> Airport? {
        if let known = airports.nearest(to: event.coordinate) {
            return known.airport
        }
        // Only a takeoff or a landing is worth naming a new place for. Pushing
        // the aircraft around the hangar apron also produces block events, and
        // those must not each mint a "Plocha 7".
        guard event.kind.isAirEvent else { return nil }
        guard settings.learnAirfields else { return nil }
        return airports.learn(at: event.coordinate, elevation: measuredElevation(near: event.coordinate) ?? event.groundElevation)
    }

    /// The ground reference, but only if it was taken close enough to this
    /// coordinate to describe the same patch of surface.
    private func measuredElevation(near coordinate: Coordinate) -> Double? {
        guard let reference = elevationProvider.groundReference else { return nil }
        let d = GeoMath.distance(reference.coordinate, coordinate)
        return d <= elevationProvider.nearFieldRadius ? reference.meters : nil
    }

    /// Renames a learned airfield and relabels the flights already logged
    /// against its old code, so a rename fixes history too.
    func renameAirfield(id: String, code: String, name: String, kind: AirfieldKind) {
        guard let previous = airports.rename(id: id, code: code, name: name, kind: kind) else { return }
        store.relabelAirport(from: previous, to: code)
        if currentFlight?.takeoff.airport == previous {
            currentFlight?.takeoff.airport = code
        }
    }

    /// Records the aircraft's current position as a named airfield.
    func addCurrentPositionAsAirfield(code: String, name: String, kind: AirfieldKind) {
        guard let fix = location.lastFix else { return }
        airports.add(
            code: code,
            name: name,
            coordinate: fix.coordinate,
            elevation: measuredElevation(near: fix.coordinate),
            kind: kind
        )
    }

    /// The reference is recomputed on every stationary fix, but writing it to
    /// UserDefaults once a second while the aircraft sits on the apron is
    /// pointless. Persist only a meaningful move, or once a minute.
    private func persistGroundReferenceIfWorthwhile(now: Date) {
        guard let reference = elevationProvider.groundReference else { return }
        let changed = settings.groundReference.map { abs($0.meters - reference.meters) > 0.5 } ?? true
        guard changed || now.timeIntervalSince(lastReferencePersist) > 60 else { return }
        lastReferencePersist = now
        settings.groundReference = reference
    }

    private func handle(_ event: FlightEvent) {
        var event = event
        event.airport = resolveAirfield(for: event)?.code
        lastEvent = event

        switch event.kind {
        case .offBlocks:
            // Held until a takeoff claims it. An off-blocks that never leads to
            // a flight — taxiing the aircraft to the hangar — is simply dropped.
            pendingOffBlocks = event

        case .onBlocks:
            closeBlocks(with: event)

        case .takeoff:
            // A takeoff while a flight is still open means we missed a landing
            // (signal loss, app killed). Leave the old entry open and honest
            // rather than inventing a landing time for it.
            let previousLanding = store.flights.compactMap(\.landing).map(\.time).max()
            let touchAndGo = previousLanding.map {
                event.time.timeIntervalSince($0) <= settings.profile.touchAndGoWindow
            } ?? false

            var flight = Flight(takeoff: event, landing: nil)
            flight.offBlocks = pendingOffBlocks
            pendingOffBlocks = nil
            flight.aircraft = settings.aircraft.isEmpty ? nil : settings.aircraft
            flight.isTouchAndGo = touchAndGo
            flight.maxAltitude = event.altitude
            flight.maxAGL = event.agl
            flight.maxSpeed = max(0, event.speed)
            currentFlight = flight
            store.upsert(flight)
            lastTrackPoint = nil

        case .landing:
            guard var flight = currentFlight else {
                // Landing with no open flight — the app was started in the air.
                // Worth recording, but as a standalone entry: there is no
                // takeoff time we could honestly claim.
                var orphan = Flight(takeoff: event, landing: event)
                orphan.aircraft = settings.aircraft.isEmpty ? nil : settings.aircraft
                store.upsert(orphan)
                currentFlight = nil
                return
            }
            flight.landing = event
            currentFlight = nil
            store.upsert(flight)
            flushTrack(force: true)
        }
    }

    /// Attaches an on-blocks time to the flight that just landed.
    ///
    /// Only to a flight whose landing is recent — an aircraft that is pushed
    /// into the hangar an hour later did not just finish taxiing in.
    private func closeBlocks(with event: FlightEvent) {
        pendingOffBlocks = nil
        guard let index = store.flights.firstIndex(where: { flight in
            guard let landing = flight.landing, flight.onBlocks == nil else { return false }
            return event.time.timeIntervalSince(landing.time) <= 3600
        }) else { return }

        var flight = store.flights[index]
        flight.onBlocks = event
        store.upsert(flight)
        if currentFlight?.id == flight.id { currentFlight = flight }
    }

    // MARK: - Track

    private func recordTrackPoint(fix: Fix, agl: Double?, speed: Double, vs: Double?) {
        // The live map and graph draw from the moment recording starts, not
        // from the moment a flight opens — the taxi out is part of what the
        // pilot wants to watch being drawn.
        let dueForLive = liveTrack.latest
            .map { fix.timestamp.timeIntervalSince($0.t) >= trackInterval } ?? true
        if dueForLive {
            liveTrack.append(TrackPoint(fix: fix, agl: agl, speed: speed, vs: vs))
        }

        guard currentFlight != nil else { return }
        if let last = lastTrackPoint, fix.timestamp.timeIntervalSince(last.t) < trackInterval { return }

        let point = TrackPoint(fix: fix, agl: agl, speed: speed, vs: vs)
        if var flight = currentFlight {
            // Distance needs a previous point; the maxima and the count do not,
            // so they must not sit behind the same condition.
            if let last = lastTrackPoint {
                flight.distance += GeoMath.distance(
                    Coordinate(latitude: last.lat, longitude: last.lon),
                    fix.coordinate
                )
            }
            flight.maxAltitude = max(flight.maxAltitude, fix.altitude)
            flight.maxSpeed = max(flight.maxSpeed, max(0, speed))
            if let agl {
                flight.maxAGL = max(flight.maxAGL ?? agl, agl)
            }
            flight.trackPointCount += 1
            currentFlight = flight
        }
        lastTrackPoint = point
        pendingTrack.append(point)

        if pendingTrack.count >= 20 || Date().timeIntervalSince(lastTrackFlush) > trackFlushInterval {
            flushTrack(force: false)
        }
    }

    private func flushTrack(force: Bool) {
        guard let flight = currentFlight ?? store.openFlight else {
            pendingTrack.removeAll()
            return
        }
        guard !pendingTrack.isEmpty else {
            if force, let current = currentFlight { store.upsert(current) }
            return
        }
        store.appendTrack(pendingTrack, to: flight.id)
        pendingTrack.removeAll()
        lastTrackFlush = Date()
        if let current = currentFlight { store.upsert(current) }
    }

    // MARK: - Manual override

    /// Detection is conservative on purpose. When it misses one — a very short
    /// hop, a receiver that dropped out over the threshold — the pilot can
    /// stamp the event by hand from the live screen.
    func logManualEvent(_ kind: FlightEventKind) {
        guard let fix = location.lastFix else { return }
        let sample = elevationProvider.bestEffort(at: fix.coordinate, now: fix.timestamp)
        let agl = sample.map { fix.altitude - $0.meters }
        // The pilot is sure it happened; confidence describes the terrain
        // evidence behind the numbers, exactly as it does for a detected event.
        // `handle` names the airfield.
        handle(
            FlightEvent(
                kind: kind,
                time: fix.timestamp,
                latitude: fix.latitude,
                longitude: fix.longitude,
                altitude: fix.altitude,
                agl: agl,
                groundElevation: sample?.meters,
                elevationSource: sample?.source ?? .unavailable,
                speed: max(0, fix.speed),
                confidence: EventConfidence.forTerrain(sample, agl: agl),
                airport: nil
            )
        )
    }

    // MARK: - Simulation

    /// Replays a synthetic track through the real pipeline. The only way to see
    /// the thing work without leaving the ground.
    func startSimulation(_ fixes: [Fix], speedFactor: Double = 20) {
        stopSimulation()
        guard !fixes.isEmpty else { return }

        // Restamp onto now, so the simulated flight lands in today's logbook
        // instead of whatever epoch the generator used.
        let offset = Date().timeIntervalSince(fixes[0].timestamp)
        let shifted = fixes.map { fix -> Fix in
            var copy = fix
            copy.timestamp = fix.timestamp.addingTimeInterval(offset)
            return copy
        }

        isSimulating = true
        applyIdleTimer()
        let delay = max(0.01, 1.0 / speedFactor)
        simulationTask = Task { @MainActor in
            for fix in shifted {
                if Task.isCancelled { break }
                ingest(fix)
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            }
            isSimulating = false
            flushTrack(force: true)
            applyIdleTimer()
        }
    }

    func stopSimulation() {
        simulationTask?.cancel()
        simulationTask = nil
        isSimulating = false
        applyIdleTimer()
    }

    /// Re-reads the user-imported airport dataset in place, so the elevation
    /// provider keeps pointing at the same database object.
    func reloadAirports() {
        let url = AppPaths.root.appendingPathComponent(AirportDatabase.userDatabaseFilename)
        guard let data = try? Data(contentsOf: url),
              let list = try? JSONDecoder().decode([Airport].self, from: data) else { return }
        airports.load(list)
    }

    // MARK: - Diagnostics

    /// Taxiing now? Block time is running.
    var isMoving: Bool { detector.isMoving }

    var cachedTiles: Int { elevationProvider.cachedTileCount }
    var groundReference: CombinedElevationProvider.GroundReference? { elevationProvider.groundReference }
    var airportCount: Int { airports.airports.count + airports.learned.count }
    var nearestAirport: Airport? {
        guard let fix = location.lastFix else { return nil }
        return airports.nearest(to: fix.coordinate)?.airport
    }
}
