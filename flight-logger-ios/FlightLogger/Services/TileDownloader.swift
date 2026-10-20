import Foundation

/// Fills an offline region, politely.
///
/// Tile servers are somebody else's machines. This one asks for tiles no faster
/// than the source says it is willing to be asked, skips anything already on
/// disk so a resumed download costs nothing, and stops the moment it is told
/// to. It also refuses outright to mass-download from a source whose terms do
/// not allow it — see `TileSource`.
@MainActor
final class TileDownloader: ObservableObject {

    struct Progress: Equatable, Sendable {
        var regionID: UUID
        var regionName: String
        var done: Int
        var skipped: Int
        var failed: Int
        var total: Int
        var bytes: Int64

        var fraction: Double {
            guard total > 0 else { return 0 }
            return min(1, Double(done + skipped) / Double(total))
        }
    }

    enum Failure: LocalizedError, Equatable {
        case sourceUnusable
        case bulkNotPermitted(String)
        case tooManyTiles(Int, limit: Int)

        var errorDescription: String? {
            switch self {
            case .sourceUnusable:
                return "Zdroj dlaždic není nastavený. Doplň adresu ve tvaru https://…/{z}/{x}/{y}.png."
            case .bulkNotPermitted(let name):
                return "\(name) nedovoluje stahovat mapu po oblastech — jeho dlaždice jsou dar, ne služba. "
                     + "Na offline mapu nastav vlastní zdroj, který to má v podmínkách."
            case .tooManyTiles(let count, let limit):
                return "Oblast má \(count) dlaždic, povolené maximum je \(limit). Zmenši okruh nebo rozsah zoomu."
            }
        }
    }

    /// Enough for a 50 km circle at zoom 10–14, and far short of anything that
    /// could fill a phone by accident.
    static let tileLimit = 20_000

    @Published private(set) var progress: Progress?
    @Published private(set) var lastError: String?

    private var task: Task<Void, Never>?
    private let session: URLSession

    var isRunning: Bool { task != nil }

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Checks a region before anything is downloaded, so the UI can refuse with
    /// a reason instead of starting and failing.
    static func validate(region: OfflineRegion, source: TileSource) -> Failure? {
        guard source.isUsable else { return .sourceUnusable }
        guard source.allowsBulkDownload else { return .bulkNotPermitted(source.name) }
        let count = region.expectedTiles
        guard count <= tileLimit else { return .tooManyTiles(count, limit: tileLimit) }
        return nil
    }

    func start(region: OfflineRegion, source: TileSource, store: TileStore) {
        guard task == nil else { return }
        if let failure = Self.validate(region: region, source: source) {
            lastError = failure.errorDescription
            return
        }
        lastError = nil

        var region = region
        region.completedAt = nil
        store.upsert(region)

        let tiles = TileMath.tiles(
            center: region.center,
            radius: region.radius,
            zooms: source.clampedZooms(region.zooms)
        )
        let interval = max(0, 1.0 / max(0.5, source.requestsPerSecond))

        progress = Progress(
            regionID: region.id,
            regionName: region.name,
            done: 0, skipped: 0, failed: 0,
            total: tiles.count,
            bytes: 0
        )

        task = Task { @MainActor in
            var state = self.progress!

            for tile in tiles {
                if Task.isCancelled { break }

                if store.has(tile) {
                    state.skipped += 1
                    self.progress = state
                    continue
                }

                guard let url = source.url(for: tile) else {
                    state.failed += 1
                    self.progress = state
                    continue
                }

                var request = URLRequest(url: url)
                // Tile servers block unidentified clients, and rightly so.
                request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
                request.timeoutInterval = 20

                do {
                    let (data, response) = try await self.session.data(for: request)
                    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                    if (200..<300).contains(code), let written = store.store(data, for: tile) {
                        state.done += 1
                        state.bytes += Int64(written)
                    } else {
                        state.failed += 1
                    }
                } catch {
                    state.failed += 1
                }

                self.progress = state

                // Hold the rate the provider asked for. Sequential and simple:
                // the only way to be sure the limit is never exceeded.
                if interval > 0 {
                    try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                }
            }

            var finished = region
            finished.storedTiles = state.done + state.skipped
            finished.bytes = state.bytes
            // Only a run that got everything counts as complete; an interrupted
            // region stays visibly partial so it can be resumed.
            finished.completedAt = (state.done + state.skipped) >= state.total && !Task.isCancelled
                ? Date()
                : nil
            store.upsert(finished)
            store.recountBytes()

            if state.failed > 0 {
                self.lastError = "\(state.failed) z \(state.total) dlaždic se nestáhlo. Zkus to znovu — hotové se přeskočí."
            }
            self.progress = nil
            self.task = nil
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        progress = nil
    }

    private static let userAgent =
        "LetovyZapisovac/1.0 (offline flight-logger map cache; contact via app settings)"
}
