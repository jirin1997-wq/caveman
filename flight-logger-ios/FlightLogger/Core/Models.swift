import Foundation

// MARK: - Fix

/// One normalized GPS sample.
///
/// Deliberately free of CoreLocation so the whole detection core can be unit
/// tested on synthetic tracks without a device or a location permission.
/// All units are SI: meters, meters per second, seconds. The UI converts to
/// knots / feet at the very edge (see `Units`).
struct Fix: Codable, Equatable, Sendable {
    var timestamp: Date
    var latitude: Double
    var longitude: Double
    /// Meters above mean sea level as reported by the GPS receiver.
    var altitude: Double
    /// Horizontal ground speed in m/s. Negative means "receiver does not know".
    var speed: Double
    /// Track over ground in degrees. Negative means unknown.
    var course: Double
    /// Radius of 68% confidence in meters. Negative means the fix is invalid.
    var horizontalAccuracy: Double
    /// Vertical 68% confidence in meters. Negative means altitude is unusable.
    var verticalAccuracy: Double

    init(
        timestamp: Date,
        latitude: Double,
        longitude: Double,
        altitude: Double,
        speed: Double = -1,
        course: Double = -1,
        horizontalAccuracy: Double = 5,
        verticalAccuracy: Double = 8
    ) {
        self.timestamp = timestamp
        self.latitude = latitude
        self.longitude = longitude
        self.altitude = altitude
        self.speed = speed
        self.course = course
        self.horizontalAccuracy = horizontalAccuracy
        self.verticalAccuracy = verticalAccuracy
    }

    var coordinate: Coordinate { Coordinate(latitude: latitude, longitude: longitude) }

    var hasUsableAltitude: Bool { verticalAccuracy >= 0 }
}

/// Minimal lat/lon pair. Mirrors CLLocationCoordinate2D without importing it.
struct Coordinate: Codable, Equatable, Sendable {
    var latitude: Double
    var longitude: Double
}

// MARK: - Elevation

/// Where a terrain elevation number came from. Surfaced in the UI so the pilot
/// can tell a solid number from a guess.
enum ElevationSource: String, Codable, Sendable {
    /// Median GPS altitude captured while the aircraft sat still on the ground.
    case groundReference
    /// Bundled airport database (offline).
    case airport
    /// Locally cached answer from a previous online lookup.
    case cache
    /// Fresh answer from the online elevation API.
    case online
    /// Nothing usable — AGL is unknown and detection runs speed/climb only.
    case unavailable

    var label: String {
        switch self {
        case .groundReference: return "reference ze země"
        case .airport: return "databáze letišť"
        case .cache: return "cache"
        case .online: return "online"
        case .unavailable: return "neznámá"
        }
    }

    /// Rough trust ordering, used when two sources disagree.
    var rank: Int {
        switch self {
        case .groundReference: return 4
        case .airport: return 3
        case .online: return 2
        case .cache: return 1
        case .unavailable: return 0
        }
    }
}

struct ElevationSample: Codable, Equatable, Sendable {
    /// Terrain elevation in meters above mean sea level.
    var meters: Double
    var source: ElevationSource
}

// MARK: - Events

enum FlightEventKind: String, Codable, Sendable {
    case takeoff
    case landing

    var label: String {
        switch self {
        case .takeoff: return "Vzlet"
        case .landing: return "Přistání"
        }
    }
}

/// How much the detector trusts an event.
///
/// `high`   — speed, AGL and climb rate all agreed, terrain elevation was solid.
/// `medium` — terrain elevation came from a weaker source, or one signal was noisy.
/// `low`    — no usable AGL at all; decided on speed and climb rate alone.
enum EventConfidence: String, Codable, Sendable {
    case high, medium, low

    var label: String {
        switch self {
        case .high: return "jistý"
        case .medium: return "pravděpodobný"
        case .low: return "nejistý"
        }
    }
}

struct FlightEvent: Codable, Equatable, Identifiable, Sendable {
    var id: UUID = UUID()
    var kind: FlightEventKind
    /// Backdated to the first fix of the qualifying window, not to the moment
    /// the detector became sure. A takeoff confirmed after 5 s of climb is
    /// stamped at the wheels-off fix.
    var time: Date
    var latitude: Double
    var longitude: Double
    /// GPS altitude MSL at the event, meters.
    var altitude: Double
    /// Height above terrain, meters. Nil when no elevation source was available.
    var agl: Double?
    var groundElevation: Double?
    var elevationSource: ElevationSource
    /// Ground speed at the event, m/s.
    var speed: Double
    var confidence: EventConfidence
    /// ICAO/local code of the nearest known airport, if any.
    var airport: String?

    var coordinate: Coordinate { Coordinate(latitude: latitude, longitude: longitude) }
}

// MARK: - Flight

/// One flight = one takeoff and the landing that closed it. A touch-and-go
/// closes a flight and opens the next one; `isTouchAndGo` marks the pair so the
/// logbook can collapse them if the pilot wants circuits counted as one flight.
struct Flight: Codable, Equatable, Identifiable, Sendable {
    var id: UUID = UUID()
    var takeoff: FlightEvent
    var landing: FlightEvent?
    var aircraft: String?
    /// Ground time before this takeoff was under `touchAndGoWindow`, i.e. the
    /// aircraft never really stopped after the previous landing.
    var isTouchAndGo: Bool = false
    /// Peak GPS altitude MSL during the flight, meters.
    var maxAltitude: Double = 0
    /// Peak height above terrain during the flight, meters.
    var maxAGL: Double?
    /// Peak ground speed, m/s.
    var maxSpeed: Double = 0
    /// Great-circle distance flown along the recorded track, meters.
    var distance: Double = 0
    /// Number of track points stored on disk for this flight.
    var trackPointCount: Int = 0

    var isOpen: Bool { landing == nil }

    /// Wheels-off to wheels-on. Nil while the flight is still open.
    var duration: TimeInterval? {
        guard let landing else { return nil }
        return landing.time.timeIntervalSince(takeoff.time)
    }

    var departureLabel: String { takeoff.airport ?? Units.coordinateLabel(takeoff.coordinate) }
    var arrivalLabel: String {
        guard let landing else { return "—" }
        return landing.airport ?? Units.coordinateLabel(landing.coordinate)
    }
}

// MARK: - Track

/// A recorded track point. Slimmer than `Fix` because it is written to disk once
/// per second for the whole flight.
struct TrackPoint: Codable, Equatable, Sendable {
    var t: Date
    var lat: Double
    var lon: Double
    /// Altitude MSL, meters.
    var alt: Double
    /// Height above terrain, meters. Nil when unknown at that moment.
    var agl: Double?
    /// Ground speed, m/s.
    var spd: Double

    init(fix: Fix, agl: Double?, speed: Double) {
        self.t = fix.timestamp
        self.lat = fix.latitude
        self.lon = fix.longitude
        self.alt = fix.altitude
        self.agl = agl
        self.spd = speed
    }
}
