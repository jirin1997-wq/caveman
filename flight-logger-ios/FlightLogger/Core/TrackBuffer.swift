import Foundation

/// A bounded, evenly thinned copy of the track, for drawing.
///
/// The recorded track goes to disk at full 1 Hz resolution — that is the
/// logbook's record and it must not lose anything. This is the other copy: the
/// one the live map draws, which has different needs. A four-hour flight is
/// 14 000 points, and redrawing that polyline once a second would cost far more
/// than it shows, since the map cannot resolve two fixes a second apart anyway.
///
/// So the buffer keeps a cap. When it fills, it drops every other point and
/// carries on at half the resolution — the track keeps its full extent and its
/// shape, and only detail nobody can see on a phone screen is lost. The first
/// and the newest point always survive, because those are the ends of the line
/// and the aircraft's own position.
struct TrackBuffer: Equatable, Sendable {

    private(set) var points: [TrackPoint] = []

    /// Points kept for drawing. 1500 is far beyond what a phone-sized map can
    /// resolve, and cheap to stroke.
    var capacity: Int

    /// How many real fixes each kept point now stands for. Starts at 1 and
    /// doubles on every thinning pass.
    private(set) var resolution = 1

    init(capacity: Int = 1500) {
        self.capacity = max(8, capacity)
    }

    mutating func append(_ point: TrackPoint) {
        points.append(point)
        if points.count > capacity { thin() }
    }

    mutating func reset() {
        points.removeAll()
        resolution = 1
    }

    var latest: TrackPoint? { points.last }

    var isEmpty: Bool { points.isEmpty }

    /// Keeps every other point, then makes sure the newest one is still the
    /// last — it is where the aircraft is, and the map draws it.
    private mutating func thin() {
        let newest = points.last
        var kept: [TrackPoint] = []
        kept.reserveCapacity(points.count / 2 + 1)
        for (index, point) in points.enumerated() where index.isMultiple(of: 2) {
            kept.append(point)
        }
        if let newest, kept.last != newest { kept.append(newest) }
        points = kept
        resolution *= 2
    }
}
