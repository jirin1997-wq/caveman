import Foundation

/// Everything the app writes lives under Application Support/FlightLogger.
/// Not Documents: the pilot has no business file-managing a track cache, and
/// Application Support is excluded from the iCloud document picker by default.
enum AppPaths {

    /// Redirects every path below, so a test can work in a directory of its own
    /// instead of the one real flights are kept in. Nil in the app.
    private static var override: URL?

    /// Points the app's storage somewhere else for the duration of a test.
    /// Pass nil to go back to Application Support.
    static func useDirectory(_ url: URL?) {
        override = url
        if let url { ensure(url) }
    }

    static var root: URL {
        if let override { return override }
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
