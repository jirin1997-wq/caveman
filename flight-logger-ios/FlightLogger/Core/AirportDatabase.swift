import Foundation

/// What kind of surface a place is. Only matters for learned entries, and only
/// for two things: how far apart two fixes can be and still be the same place,
/// and what the logbook calls it.
enum AirfieldKind: String, Codable, Sendable, CaseIterable {
    case land
    case water

    var label: String {
        switch self {
        case .land: return "Plocha / letiště"
        case .water: return "Vodní plocha"
        }
    }

    var shortLabel: String {
        switch self {
        case .land: return "plocha"
        case .water: return "voda"
        }
    }
}

struct Airport: Codable, Equatable, Sendable, Identifiable {
    /// ICAO code where one exists, otherwise the local identifier. For a
    /// learned airfield this is whatever the pilot typed — "LKHN".
    var code: String
    var name: String
    var latitude: Double
    var longitude: Double
    /// Field elevation in meters MSL. Nil when nothing has supplied one — the
    /// airfield is then used only to name a departure or arrival, never as a
    /// terrain source.
    var elevation: Double?
    /// Stable identity for learned airfields, so renaming one does not create a
    /// second entry. Absent in dataset rows, where the code is identity enough.
    var uid: String?
    /// True for airfields the app learned or the pilot added by hand. These are
    /// the only ones it may edit or overwrite.
    var learned: Bool?
    /// Land or water. Absent means land — the overwhelming majority, and what
    /// every dataset row is.
    var kind: AirfieldKind?

    init(
        code: String,
        name: String,
        latitude: Double,
        longitude: Double,
        elevation: Double? = nil,
        uid: String? = nil,
        learned: Bool? = nil,
        kind: AirfieldKind? = nil
    ) {
        self.code = code
        self.name = name
        self.latitude = latitude
        self.longitude = longitude
        self.elevation = elevation
        self.uid = uid
        self.learned = learned
        self.kind = kind
    }

    var id: String { uid ?? code }
    var coordinate: Coordinate { Coordinate(latitude: latitude, longitude: longitude) }
    var isLearned: Bool { learned == true }
    var surface: AirfieldKind { kind ?? .land }

    /// How far from this place a fix can be and still count as the same place.
    ///
    /// A runway is a couple of kilometres end to end. A lake is not: a
    /// floatplane can lift off at one end and land at the other, and those are
    /// the same water aerodrome, not two.
    var matchRadius: Double {
        switch surface {
        case .land: return 2_000
        case .water: return 6_000
        }
    }
}

/// Offline airfield lookup, in two layers.
///
/// **Dataset layer** — the bundled seed, or a full OurAirports import. Read
/// only.
///
/// **Learned layer** — every place a flight has actually started or ended.
/// This is what makes the app work at LKHN, at a farm strip, at anywhere that
/// never made it into a dataset: the first time a flight ends somewhere
/// unknown, the app records the spot and the field elevation it measured on the
/// ground there. Rename it once ("LKHN") and every later flight from that field
/// is labelled and has its elevation offline, before the aircraft has even
/// stopped moving.
///
/// Both layers answer `nearest(to:)` and `elevation(at:)`. Learned entries win
/// ties, because a spot the pilot named is more specific than a dataset row.
@MainActor
final class AirportDatabase: ObservableObject {

    static let userDatabaseFilename = "airports.json"
    static let learnedFilename = "learned-airfields.json"

    @Published private(set) var airports: [Airport] = []
    @Published private(set) var learned: [Airport] = []

    /// Dataset rows bucketed by whole degree of latitude/longitude. A full
    /// OurAirports import is ~80k rows; scanning all of them once per second
    /// would be wasteful, and a 3×3 degree neighbourhood is far more than the
    /// lookup radius needs. The learned list stays unbucketed — there are never
    /// more than a handful.
    private var index: [Int: [Airport]] = [:]
    private var learnedURL: URL?

    init(airports: [Airport] = [], learned: [Airport] = [], learnedURL: URL? = nil) {
        self.learnedURL = learnedURL
        load(airports)
        self.learned = learned
        self.kind = kind
    }

    /// Bundled seed (or a user import), plus whatever the app has learned.
    static func loadDefault(bundle: Bundle = .main, userDirectory: URL? = nil) -> AirportDatabase {
        let db = AirportDatabase(learnedURL: userDirectory?.appendingPathComponent(learnedFilename))

        if let dir = userDirectory {
            let url = dir.appendingPathComponent(userDatabaseFilename)
            if let data = try? Data(contentsOf: url),
               let list = try? JSONDecoder().decode([Airport].self, from: data),
               !list.isEmpty {
                db.load(list)
            }
        }
        if db.airports.isEmpty,
           let url = bundle.url(forResource: "airports", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let list = try? JSONDecoder().decode([Airport].self, from: data) {
            db.load(list)
        }
        db.loadLearned()
        return db
    }

    func load(_ list: [Airport]) {
        airports = list
        index.removeAll()
        for airport in list {
            index[Self.key(airport.latitude, airport.longitude), default: []].append(airport)
        }
    }

    // MARK: - Lookup

    /// Nearest airfield within `radius` meters, or nil.
    ///
    /// Five kilometres, not more: this is "which airfield am I at", and a
    /// radius generous enough to swallow the next strip over would stop the app
    /// ever learning that strip.
    func nearest(to coordinate: Coordinate, within radius: Double = 5_000) -> (airport: Airport, distance: Double)? {
        var best: (airport: Airport, distance: Double)?
        for candidate in learned + candidates(around: coordinate) {
            let d = GeoMath.distance(coordinate, candidate.coordinate)
            guard d <= radius else { continue }
            // Strictly less: the learned list is scanned first, so a learned
            // airfield keeps an exact tie.
            if best == nil || d < best!.distance { best = (candidate, d) }
        }
        return best
    }

    /// Field elevation of the nearest airfield that actually has one.
    ///
    /// The radius is deliberately tighter than `nearest(to:)`: a runway
    /// elevation describes the runway, not the ridge four kilometres away.
    func elevation(at coordinate: Coordinate, within radius: Double = 4_000) -> ElevationSample? {
        var best: (elevation: Double, distance: Double)?
        for candidate in learned + candidates(around: coordinate) {
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

    /// The place this coordinate belongs to, if the app already knows one.
    ///
    /// Each candidate is judged by its own radius, so a lake keeps its six
    /// kilometres while the airfield beside it keeps its two.
    func existingMatch(for coordinate: Coordinate) -> Airport? {
        var best: (airport: Airport, distance: Double)?
        for candidate in learned + candidates(around: coordinate) {
            let d = GeoMath.distance(coordinate, candidate.coordinate)
            guard d <= candidate.matchRadius else { continue }
            if best == nil || d < best!.distance { best = (candidate, d) }
        }
        return best?.airport
    }

    // MARK: - Learning

    /// Records a place a flight started or ended.
    ///
    /// Returns the existing airfield when one is already in range — a takeoff
    /// and the landing that follows it at the same strip must not produce two
    /// entries, and each place is judged by its own `matchRadius`. Otherwise
    /// creates one named "Plocha N" for the pilot to rename.
    @discardableResult
    func learn(at coordinate: Coordinate, elevation: Double? = nil) -> Airport {
        if let existing = existingMatch(for: coordinate) {
            if let elevation { setElevation(elevation, for: existing.id) }
            return current(existing.id) ?? existing
        }
        let airfield = Airport(
            code: nextPlaceholderCode(),
            name: "Nepojmenovaná plocha",
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            elevation: elevation,
            uid: UUID().uuidString,
            learned: true
        )
        learned.append(airfield)
        saveLearned()
        return airfield
    }

    /// Adds an airfield the pilot typed in by hand.
    @discardableResult
    func add(
        code: String,
        name: String,
        coordinate: Coordinate,
        elevation: Double?,
        kind: AirfieldKind = .land
    ) -> Airport {
        let airfield = Airport(
            code: code,
            name: name,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            elevation: elevation,
            uid: UUID().uuidString,
            learned: true,
            kind: kind
        )
        learned.append(airfield)
        saveLearned()
        return airfield
    }

    /// Renames a learned airfield. Returns the code it used to have, so the
    /// logbook can relabel the flights that already reference it.
    @discardableResult
    func rename(id: String, code: String, name: String, kind: AirfieldKind? = nil) -> String? {
        guard let index = learned.firstIndex(where: { $0.id == id }) else { return nil }
        let previous = learned[index].code
        learned[index].code = code
        learned[index].name = name
        if let kind { learned[index].kind = kind }
        saveLearned()
        return previous == code ? nil : previous
    }

    /// Fills in a field elevation the app measured on the ground.
    ///
    /// Only ever touches an entry that has no elevation, or one the pilot owns.
    /// A published field elevation from a real dataset is not something a
    /// handheld GPS gets to overwrite.
    func setElevation(_ meters: Double, for id: String) {
        guard let index = learned.firstIndex(where: { $0.id == id }) else { return }
        guard learned[index].elevation == nil || learned[index].isLearned else { return }
        guard learned[index].elevation != meters else { return }
        learned[index].elevation = meters
        saveLearned()
    }

    /// Called while the aircraft sits still: if it is parked at a learned
    /// airfield that has no elevation yet, this is the moment to record one.
    func noteMeasuredElevation(_ meters: Double, at coordinate: Coordinate) {
        guard let match = existingMatch(for: coordinate) else { return }
        guard match.isLearned, match.elevation == nil else { return }
        setElevation(meters, for: match.id)
    }

    func forget(id: String) {
        learned.removeAll { $0.id == id }
        saveLearned()
    }

    func current(_ id: String) -> Airport? {
        learned.first(where: { $0.id == id })
    }

    private func nextPlaceholderCode() -> String {
        var n = learned.count + 1
        while learned.contains(where: { $0.code == "Plocha \(n)" }) { n += 1 }
        return "Plocha \(n)"
    }

    // MARK: - Persistence

    func loadLearned() {
        guard let learnedURL, let data = try? Data(contentsOf: learnedURL) else { return }
        learned = (try? JSONDecoder().decode([Airport].self, from: data)) ?? []
    }

    /// Best effort — a learned airfield that fails to persist costs a rename,
    /// never a lost flight.
    func saveLearned() {
        guard let learnedURL, let data = try? JSONEncoder().encode(learned) else { return }
        try? data.write(to: learnedURL, options: .atomic)
    }
}
