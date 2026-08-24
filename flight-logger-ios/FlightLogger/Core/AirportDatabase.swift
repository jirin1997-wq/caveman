import Foundation

struct Airport: Codable, Equatable, Sendable, Identifiable {
    /// ICAO code where one exists, otherwise the local identifier.
    var code: String
    var name: String
    var latitude: Double
    var longitude: Double
    /// Field elevation in meters MSL. Nil when the dataset does not carry one —
    /// the airport is then used only to name a departure or arrival, never as a
    /// terrain source.
    var elevation: Double?

    var id: String { code }
    var coordinate: Coordinate { Coordinate(latitude: latitude, longitude: longitude) }
}

/// Offline airport lookup.
///
/// Two jobs: name the departure and arrival in the logbook, and supply a field
/// elevation when the aircraft is close enough to an airfield that the runway
/// is what is underneath it.
///
/// Ships with a small seed list (see `Resources/airports.json`). A full dataset
/// with elevations can be imported — `tools/build-airports.mjs` converts the
/// OurAirports CSV into the same format, and the result is dropped into
/// Application Support where it takes precedence over the bundled seed.
final class AirportDatabase {

    static let userDatabaseFilename = "airports.json"

    private(set) var airports: [Airport] = []
    /// Airports bucketed by whole degree of latitude/longitude. A full
    /// OurAirports import is ~80k rows; scanning all of them once per second
    /// would be wasteful, and a 3×3 degree neighbourhood is far more than the
    /// lookup radius needs.
    private var index: [Int: [Airport]] = [:]

    init(airports: [Airport] = []) {
        load(airports)
    }

    /// Bundled seed, overridden by a user-imported dataset when present.
    static func loadDefault(bundle: Bundle = .main, userDirectory: URL? = nil) -> AirportDatabase {
        let db = AirportDatabase()
        if let dir = userDirectory {
            let url = dir.appendingPathComponent(userDatabaseFilename)
            if let data = try? Data(contentsOf: url),
               let list = try? JSONDecoder().decode([Airport].self, from: data),
               !list.isEmpty {
                db.load(list)
                return db
            }
        }
        if let url = bundle.url(forResource: "airports", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let list = try? JSONDecoder().decode([Airport].self, from: data) {
            db.load(list)
        }
        return db
    }

    func load(_ list: [Airport]) {
        airports = list
        index.removeAll()
        for airport in list {
            index[Self.key(airport.latitude, airport.longitude), default: []].append(airport)
        }
    }

    /// Nearest airport within `radius` meters, or nil.
    func nearest(to coordinate: Coordinate, within radius: Double = 8_000) -> (airport: Airport, distance: Double)? {
        var best: (Airport, Double)?
        for candidate in candidates(around: coordinate) {
            let d = GeoMath.distance(coordinate, candidate.coordinate)
            guard d <= radius else { continue }
            if best == nil || d < best!.1 { best = (candidate, d) }
        }
        guard let best else { return nil }
        return (airport: best.0, distance: best.1)
    }

    /// Field elevation of the nearest airport that actually has one.
    ///
    /// The radius is deliberately tighter than `nearest(to:)`: a runway
    /// elevation describes the runway, not the ridge four kilometres away.
    func elevation(at coordinate: Coordinate, within radius: Double = 4_000) -> ElevationSample? {
        var best: (elevation: Double, distance: Double)?
        for candidate in candidates(around: coordinate) {
            guard let elevation = candidate.elevation else { continue }
            let d = GeoMath.distance(coordinate, candidate.coordinate)
            guard d <= radius else { continue }
            if best == nil || d < best!.distance { best = (elevation, d) }
        }
        guard let best else { return nil }
        return ElevationSample(meters: best.elevation, source: .airport)
    }

    private func candidates(around coordinate: Coordinate) -> [Airport] {
        var out: [Airport] = []
        let lat = Int(floor(coordinate.latitude))
        let lon = Int(floor(coordinate.longitude))
        for dLat in -1...1 {
            for dLon in -1...1 {
                if let bucket = index[Self.key(Double(lat + dLat), Double(lon + dLon))] {
                    out.append(contentsOf: bucket)
                }
            }
        }
        return out
    }

    private static func key(_ lat: Double, _ lon: Double) -> Int {
        // 360 keeps the two coordinates from colliding; the offsets keep the
        // western and southern hemispheres non-negative.
        (Int(floor(lat)) + 90) * 360 + (Int(floor(lon)) + 180)
    }
}
