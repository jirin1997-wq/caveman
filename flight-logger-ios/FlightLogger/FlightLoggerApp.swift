import SwiftUI

@main
@MainActor
struct FlightLoggerApp: App {

    @StateObject private var settings: AppSettings
    @StateObject private var store: FlightStore
    @StateObject private var location: LocationService
    @StateObject private var recorder: FlightRecorder

    init() {
        let settings = AppSettings()
        let store = FlightStore()
        // The location service is its own observable object so views can react
        // to authorization changes without the recorder having to mirror them.
        let location = LocationService()
        _settings = StateObject(wrappedValue: settings)
        _store = StateObject(wrappedValue: store)
        _location = StateObject(wrappedValue: location)
        _recorder = StateObject(wrappedValue: FlightRecorder(store: store, settings: settings, location: location))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(settings)
                .environmentObject(store)
                .environmentObject(location)
                .environmentObject(recorder)
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            LiveView()
                .tabItem { Label("Let", systemImage: "airplane") }
            LogbookView()
                .tabItem { Label("Deník", systemImage: "book.closed") }
            SettingsView()
                .tabItem { Label("Nastavení", systemImage: "gearshape") }
        }
        .tint(.orange)
    }
}
