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

    let store: FlightStore
    let settings: AppSettings
    let location: LocationService
    let elevationProvider: CombinedElevationProvider

    private let detector: FlightDetector
    private let airports: AirportDatabase

    private var pendingTrack: [TrackPoint] = []
    private var lastTrackFlush = Date.distantPast
    private var lastTrackPoint: TrackPoint?
    private var lastReferencePersist = Date.distantPast
    private var simulationTask: Task<Void, Never>?

    /// One track point per second is plenty; a receiver that reports faster
    /// would otherwise triple the file size for no extra detail.
    private let trackInterval: TimeInterval = 1
    private let trackFlushInterval: TimeInterval = 20

    init(store: FlightStore, settings: AppSettings, location: LocationService = LocationService()) {
        self.store = store
        self.settings = settings
        self.location = location
        self.airports = AirportDatabase.loadDefault(userDirectory: AppPaths.root)
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
        isRecording = location.isRunning
        applyIdleTimer()
    }

    func stop() {
        location.stop()
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

        let events = detector.ingest(fix, elevation: sample)
        snapshot = detector.snapshot

        // Terrain reference: only while the aircraft is demonstrably not
        // flying, and only when nearly stopped. A hovering helicopter or a slow
        // glider must never be mistaken for "parked" and poison the reference.
        if detector.phase != .airborne, detector.phase != .approach, snapshot.speed >= 0, snapshot.speed < 2 {
            elevationProvider.noteGroundSample(fix)
            persistGroundReferenceIfWorthwhile(now: fix.timestamp)
        } else if detector.phase == .airborne {
            elevationProvider.endGroundRun()
        }

        elevationProvider.prefetch(around: fix.coordinate, now: fix.timestamp)

        for event in events {
            handle(event)
        }

        recordTrackPoint(fix: fix, agl: snapshot.agl, speed: snapshot.speed)
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
        event.airport = airports.nearest(to: event.coordinate)?.airport.code
        lastEvent = event

        switch event.kind {
        case .takeoff:
            // A takeoff while a flight is still open means we missed a landing
            // (signal loss, app killed). Leave the old entry open and honest
            // rather than inventing a landing time for it.
            let previousLanding = store.flights.compactMap(\.landing).map(\.time).max()
            let touchAndGo = previousLanding.map {
                event.time.timeIntervalSince($0) <= settings.profile.touchAndGoWindow
            } ?? false

            var flight = Flight(takeoff: event, landing: nil)
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

    // MARK: - Track

    private func recordTrackPoint(fix: Fix, agl: Double?, speed: Double) {
        guard currentFlight != nil else { return }
        if let last = lastTrackPoint, fix.timestamp.timeIntervalSince(last.t) < trackInterval { return }

        let point = TrackPoint(fix: fix, agl: agl, speed: speed)
        if let last = lastTrackPoint, var flight = currentFlight {
            flight.distance += GeoMath.distance(
                Coordinate(latitude: last.lat, longitude: last.lon),
                fix.coordinate
            )
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
        var event = FlightEvent(
            kind: kind,
            time: fix.timestamp,
            latitude: fix.latitude,
            longitude: fix.longitude,
            altitude: fix.altitude,
            agl: sample.map { fix.altitude - $0.meters },
            groundElevation: sample?.meters,
            elevationSource: sample?.source ?? .unavailable,
            speed: max(0, fix.speed),
            confidence: .high,
            airport: nil
        )
        event.airport = airports.nearest(to: event.coordinate)?.airport.code
        handle(event)
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

    var cachedTiles: Int { elevationProvider.cachedTileCount }
    var groundReference: CombinedElevationProvider.GroundReference? { elevationProvider.groundReference }
    var airportCount: Int { airports.airports.count }
    var nearestAirport: Airport? {
        guard let fix = location.lastFix else { return nil }
        return airports.nearest(to: fix.coordinate)?.airport
    }
}
