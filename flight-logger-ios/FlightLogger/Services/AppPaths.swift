import Foundation

/// Everything the app writes lives under Application Support/FlightLogger.
/// Not Documents: the pilot has no business file-managing a track cache, and
/// Application Support is excluded from the iCloud document picker by default.
enum AppPaths {

    static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("FlightLogger", isDirectory: true)
        ensure(dir)
        return dir
    }

    static var tracks: URL {
        let dir = root.appendingPathComponent("tracks", isDirectory: true)
        ensure(dir)
        return dir
    }

    static var exports: URL {
        let dir = root.appendingPathComponent("exports", isDirectory: true)
        ensure(dir)
        return dir
    }

    static var flightsFile: URL { root.appendingPathComponent("flights.json") }

    static func trackFile(_ id: UUID) -> URL {
        tracks.appendingPathComponent("\(id.uuidString).jsonl")
    }

    private static func ensure(_ url: URL) {
        guard !FileManager.default.fileExists(atPath: url.path) else { return }
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}
