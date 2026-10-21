import Foundation

/// A field as seen from the aircraft: where it is, how far, and which way.
struct AirfieldBearing: Identifiable, Equatable, Sendable {
    var airport: Airport
    /// Metres.
    var distance: Double
    /// Degrees true, [0, 360).
    var bearing: Double

    var id: String { airport.id }
}
