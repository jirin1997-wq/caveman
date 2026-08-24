import Foundation

/// Logbook persistence.
///
/// The flight index is a single JSON file — small, rewritten whole on every
/// change. Tracks are one JSONL file per flight, appended to as fixes arrive,
/// because rewriting a 3600-point track once a second would be absurd.
///
/// Nothing here throws at the caller. A disk failure mid-flight must not take
/// the recording down; it degrades to "this flight lost its track", and the
/// event log — the part the pilot actually needs — is already on disk.
@MainActor
final class FlightStore: ObservableObject {

    @Published private(set) var flights: [Flight] = []

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.withoutEscapingSlashes]
        return e
    }()

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init() {
        load()
    }

    // MARK: - Index

    func load() {
        guard let data = try? Data(contentsOf: AppPaths.flightsFile) else { return }
        flights = (try? decoder.decode([Flight].self, from: data)) ?? []
        sort()
    }

    func save() {
        guard let data = try? encoder.encode(flights) else { return }
        try? data.write(to: AppPaths.flightsFile, options: .atomic)
    }

    func upsert(_ flight: Flight) {
        if let index = flights.firstIndex(where: { $0.id == flight.id }) {
            flights[index] = flight
        } else {
            flights.append(flight)
        }
        sort()
        save()
    }

    func delete(_ flight: Flight) {
        flights.removeAll { $0.id == flight.id }
        try? FileManager.default.removeItem(at: AppPaths.trackFile(flight.id))
        save()
    }

    func deleteAll() {
        for flight in flights {
            try? FileManager.default.removeItem(at: AppPaths.trackFile(flight.id))
        }
        flights.removeAll()
        save()
    }

    private func sort() {
        flights.sort { $0.takeoff.time > $1.takeoff.time }
    }

    var openFlight: Flight? { flights.first(where: { $0.isOpen }) }

    // MARK: - Tracks

    /// Appends track points to a flight's JSONL file.
    func appendTrack(_ points: [TrackPoint], to id: UUID) {
        guard !points.isEmpty else { return }
        var blob = Data()
        for point in points {
            guard let line = try? encoder.encode(point) else { continue }
            blob.append(line)
            blob.append(0x0A)  // \n
        }
        guard !blob.isEmpty else { return }

        let url = AppPaths.trackFile(id)
        if let handle = try? FileHandle(forWritingTo: url) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: blob)
        } else {
            try? blob.write(to: url, options: .atomic)
        }
    }

    func track(for id: UUID) -> [TrackPoint] {
        guard let data = try? Data(contentsOf: AppPaths.trackFile(id)) else { return [] }
        var points: [TrackPoint] = []
        for line in data.split(separator: 0x0A) {
            if let point = try? decoder.decode(TrackPoint.self, from: Data(line)) {
                points.append(point)
            }
        }
        return points
    }

    // MARK: - Export

    /// GPX 1.1 track, readable by SeeYou, Google Earth, most logbook software.
    func exportGPX(_ flight: Flight) -> URL? {
        let points = track(for: flight.id)
        guard !points.isEmpty else { return nil }

        let formatter = ISO8601DateFormatter()
        var xml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="FlightLogger" xmlns="http://www.topografix.com/GPX/1/1">
          <metadata><time>\(formatter.string(from: flight.takeoff.time))</time></metadata>
          <trk>
            <name>\(escape(flight.departureLabel)) - \(escape(flight.arrivalLabel))</name>
            <trkseg>

        """
        for point in points {
            xml += """
                  <trkpt lat="\(point.lat)" lon="\(point.lon)"><ele>\(point.alt)</ele><time>\(formatter.string(from: point.t))</time></trkpt>

            """
        }
        xml += """
            </trkseg>
          </trk>
        </gpx>
        """

        let url = AppPaths.exports.appendingPathComponent("flight-\(flight.id.uuidString.prefix(8)).gpx")
        guard let data = xml.data(using: .utf8), (try? data.write(to: url, options: .atomic)) != nil else { return nil }
        return url
    }

    /// The whole logbook as CSV, for anyone who keeps their hours in a
    /// spreadsheet.
    func exportLogbookCSV() -> URL? {
        var csv = "datum;odlet;prilet;vzlet;pristani;doba;letadlo;max_alt_ft;max_agl_ft;vzdalenost_nm;jistota\n"
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        let clock = DateFormatter()
        clock.dateFormat = "HH:mm:ss"

        for flight in flights.sorted(by: { $0.takeoff.time < $1.takeoff.time }) {
            let fields: [String] = [
                day.string(from: flight.takeoff.time),
                flight.departureLabel,
                flight.arrivalLabel,
                clock.string(from: flight.takeoff.time),
                flight.landing.map { clock.string(from: $0.time) } ?? "",
                Units.durationLabel(flight.duration),
                flight.aircraft ?? "",
                String(Int(Units.metersToFeet(flight.maxAltitude).rounded())),
                flight.maxAGL.map { String(Int(Units.metersToFeet($0).rounded())) } ?? "",
                String(format: "%.1f", flight.distance / 1852),
                flight.takeoff.confidence.label
            ]
            csv += fields.map { $0.replacingOccurrences(of: ";", with: ",") }.joined(separator: ";") + "\n"
        }

        let url = AppPaths.exports.appendingPathComponent("logbook.csv")
        guard let data = csv.data(using: .utf8), (try? data.write(to: url, options: .atomic)) != nil else { return nil }
        return url
    }

    private func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
