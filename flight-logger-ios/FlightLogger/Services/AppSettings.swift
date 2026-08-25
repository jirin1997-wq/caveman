import Foundation

/// User settings, persisted to UserDefaults as one JSON blob.
@MainActor
final class AppSettings: ObservableObject {

    private struct Stored: Codable {
        var profile: DetectionProfile
        var aircraft: String
        var useOnlineElevation: Bool
        var keepScreenAwake: Bool
        var learnAirfields: Bool?
        var groundReference: CombinedElevationProvider.GroundReference?
    }

    private static let key = "flightlogger.settings.v1"

    @Published var profile: DetectionProfile { didSet { persist() } }
    @Published var aircraft: String { didSet { persist() } }
    /// Off = the app never touches the network. Detection still works from the
    /// ground reference and the airport database.
    @Published var useOnlineElevation: Bool { didSet { persist() } }
    /// Keeps the screen on while recording. Handy on a kneeboard, brutal on the
    /// battery — the pilot chooses.
    @Published var keepScreenAwake: Bool { didSet { persist() } }
    /// Whether a takeoff or landing somewhere unknown creates an airfield.
    /// Off means unknown places stay as coordinates in the logbook.
    @Published var learnAirfields: Bool { didSet { persist() } }

    /// Survives an app restart so a mid-flight relaunch does not lose the field
    /// elevation the app measured before departure.
    @Published var groundReference: CombinedElevationProvider.GroundReference? { didSet { persist() } }

    private var loaded = false

    init() {
        let stored: Stored?
        if let data = UserDefaults.standard.data(forKey: Self.key) {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            stored = try? decoder.decode(Stored.self, from: data)
        } else {
            stored = nil
        }
        profile = stored?.profile ?? .default
        aircraft = stored?.aircraft ?? ""
        useOnlineElevation = stored?.useOnlineElevation ?? true
        keepScreenAwake = stored?.keepScreenAwake ?? true
        learnAirfields = stored?.learnAirfields ?? true
        groundReference = stored?.groundReference
        loaded = true
    }

    private func persist() {
        guard loaded else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let stored = Stored(
            profile: profile,
            aircraft: aircraft,
            useOnlineElevation: useOnlineElevation,
            keepScreenAwake: keepScreenAwake,
            learnAirfields: learnAirfields,
            groundReference: groundReference
        )
        guard let data = try? encoder.encode(stored) else { return }
        UserDefaults.standard.set(data, forKey: Self.key)
    }
}
