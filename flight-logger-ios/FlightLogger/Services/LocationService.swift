import CoreLocation
import Foundation

/// CoreLocation wrapper that hands the rest of the app plain `Fix` values.
///
/// Configured for flight, not for walking directions:
/// - `kCLLocationAccuracyBestForNavigation` and no distance filter, so fixes
///   arrive at ~1 Hz and the climb-rate regression has something to chew on.
/// - `pausesLocationUpdatesAutomatically = false`. iOS otherwise decides the
///   user has stopped moving and quietly turns the GPS off — which in a cruise
///   at constant speed and heading is exactly the wrong call.
/// - `allowsBackgroundLocationUpdates = true` plus the `location` background
///   mode, so the log keeps running with the phone in a pocket. This needs
///   **Always** authorization; with **When In Use** the app records only while
///   it is on screen.
@MainActor
final class LocationService: NSObject, ObservableObject {

    @Published private(set) var authorization: CLAuthorizationStatus = .notDetermined
    @Published private(set) var isRunning = false
    @Published private(set) var lastFix: Fix?

    /// Called on the main actor for every accepted fix.
    var onFix: ((Fix) -> Void)?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
        authorization = manager.authorizationStatus
    }

    func requestAuthorization() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse:
            // Only meaningful to ask for Always once When In Use is granted.
            manager.requestAlwaysAuthorization()
        default:
            break
        }
    }

    func start() {
        guard !isRunning else { return }
        guard authorization == .authorizedAlways || authorization == .authorizedWhenInUse else {
            requestAuthorization()
            return
        }
        // Setting this without the background mode in Info.plist throws an
        // exception, so it is guarded by the entitlement being present.
        if authorization == .authorizedAlways {
            manager.allowsBackgroundLocationUpdates = true
            manager.showsBackgroundLocationIndicator = true
        }
        manager.startUpdatingLocation()
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        isRunning = false
    }

    /// True when the app can keep logging with the screen off.
    var canRecordInBackground: Bool { authorization == .authorizedAlways }
}

// MARK: - CLLocationManagerDelegate

extension LocationService: CLLocationManagerDelegate {

    /// CoreLocation delivers on the queue the manager was created on — the main
    /// queue here — so assuming main-actor isolation is sound. The CLLocation is
    /// converted to a `Fix` before crossing, which keeps the isolation check to
    /// value types only.
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let fixes = locations.compactMap(Self.fix(from:))
        guard !fixes.isEmpty else { return }
        MainActor.assumeIsolated {
            for fix in fixes {
                lastFix = fix
                onFix?(fix)
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated {
            authorization = status
            if status == .authorizedAlways, isRunning {
                manager.allowsBackgroundLocationUpdates = true
                manager.showsBackgroundLocationIndicator = true
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Transient CoreLocation errors (kCLErrorLocationUnknown) are routine
        // indoors and resolve themselves. Nothing to do but keep listening.
    }

    private nonisolated static func fix(from location: CLLocation) -> Fix? {
        guard location.horizontalAccuracy >= 0 else { return nil }
        return Fix(
            timestamp: location.timestamp,
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude,
            altitude: location.altitude,
            speed: location.speed,
            course: location.course,
            horizontalAccuracy: location.horizontalAccuracy,
            verticalAccuracy: location.verticalAccuracy
        )
    }
}
