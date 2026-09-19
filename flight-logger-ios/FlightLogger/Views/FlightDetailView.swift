import MapKit
import SwiftUI
import UIKit

struct FlightDetailView: View {

    var flight: Flight

    @EnvironmentObject private var store: FlightStore
    @State private var track: [TrackPoint] = []
    @State private var shareURL: URL?
    @State private var scrubbed: Date?
    @State private var editing = false

    /// Read back from the store so an edit shows up without leaving the screen.
    private var current: Flight {
        store.flights.first { $0.id == flight.id } ?? flight
    }

    /// The track point the pilot is pointing at in the graph.
    private var marked: TrackPoint? {
        guard let scrubbed, !track.isEmpty else { return nil }
        return track.min { abs($0.t.timeIntervalSince(scrubbed)) < abs($1.t.timeIntervalSince(scrubbed)) }
    }

    private var scrubHint: String {
        guard let marked else {
            return "Potáhni prstem po grafu — na mapě se ukáže, kde letadlo v tu chvíli bylo."
        }
        let clock = marked.t.formatted(date: .omitted, time: .standard)
        let agl = Units.feetLabel(marked.agl)
        return "V \(clock): \(Units.knotsLabel(marked.spd)), \(agl) nad zemí."
    }

    var body: some View {
        List {
            if !track.isEmpty {
                Section {
                    TrackMap(track: track, flight: current, marked: marked)
                        .frame(height: 240)
                        .listRowInsets(EdgeInsets())
                }

                Section {
                    FlightGraph(points: track, highlight: scrubbed) { scrubbed = $0 }
                        .padding(.vertical, 4)
                } header: {
                    HStack {
                        Text("Průběh")
                        Spacer()
                        if let marked {
                            Text(marked.t.formatted(date: .omitted, time: .standard))
                                .font(.caption.monospacedDigit())
                            Button("Zrušit") { scrubbed = nil }
                                .font(.caption)
                                .textCase(nil)
                        }
                    }
                } footer: {
                    Text(scrubHint)
                }
            }

            Section("Časy") {
                row("Vyjetí (off-blocks)", current.offBlocks.map { $0.time.formatted(date: .omitted, time: .standard) } ?? "—")
                row("Vzlet", current.takeoff.time.formatted(date: .abbreviated, time: .standard))
                row("Přistání", current.landing.map { $0.time.formatted(date: .abbreviated, time: .standard) } ?? "—")
                row("Zastavení (on-blocks)", current.onBlocks.map { $0.time.formatted(date: .omitted, time: .standard) } ?? "—")
                row("Doba letu", Units.durationLabel(current.duration))
                row("Blokový čas", Units.durationLabel(current.blockTime))
                row("Pojíždění celkem", Units.durationLabel(current.taxiTime))
            }

            Section {
                if let note = current.note, !note.isEmpty {
                    Text(note)
                        .font(.callout)
                }
                Button {
                    editing = true
                } label: {
                    Label(
                        current.note?.isEmpty == false ? "Upravit poznámku" : "Přidat poznámku",
                        systemImage: "square.and.pencil"
                    )
                }
            } header: {
                Text("Poznámka")
            }

            Section("Souhrn") {
                row("Odlet", current.departureLabel)
                row("Přílet", current.arrivalLabel)
                row("Letadlo", current.aircraft ?? "—")
                row("Max. výška MSL", Units.feetLabel(current.maxAltitude))
                row("Max. nad zemí", Units.feetLabel(current.maxAGL))
                row("Max. rychlost", Units.knotsLabel(current.maxSpeed))
                row("Uletěno", Units.distanceLabel(current.distance))
            }

            Section("Detekce") {
                if let offBlocks = current.offBlocks {
                    eventRow(offBlocks)
                }
                eventRow(current.takeoff)
                if let landing = current.landing {
                    eventRow(landing)
                }
                if let onBlocks = current.onBlocks {
                    eventRow(onBlocks)
                }
            }

            Section {
                Button {
                    shareURL = store.exportGPX(current)
                } label: {
                    Label("Exportovat GPX", systemImage: "square.and.arrow.up")
                }
                .disabled(track.isEmpty)
            } footer: {
                Text(track.isEmpty
                     ? "K tomuto letu není uložená trasa."
                     : "\(track.count) bodů trasy. GPX otevře SeeYou, Google Earth i většina deníků.")
            }
        }
        .navigationTitle(flight.takeoff.time.formatted(date: .abbreviated, time: .shortened))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            track = store.track(for: flight.id)
        }
        .sheet(item: Binding(
            get: { shareURL.map(ShareItem.init) },
            set: { shareURL = $0?.url }
        )) { item in
            ShareSheet(url: item.url)
        }
        .sheet(isPresented: $editing) {
            FlightEditor(flight: current) { store.upsert($0) }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editing = true
                } label: {
                    Label("Upravit", systemImage: "square.and.pencil")
                }
            }
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(value).foregroundStyle(.secondary).monospacedDigit()
        }
    }

    private func eventRow(_ event: FlightEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(event.kind.label).font(.headline)
                Spacer()
                Tag(text: event.confidence.label, color: event.confidence == .high ? .green : .orange)
            }
            Text(event.time.formatted(date: .omitted, time: .standard))
                .font(.subheadline)
            Text("\(Units.knotsLabel(event.speed)) · AGL \(Units.feetLabel(event.agl)) · terén \(event.groundElevation.map { "\(Int($0.rounded())) m" } ?? "—") (\(event.elevationSource.label))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

/// The recorded track, drawn over the map. Takeoff and landing get their own
/// markers so a glance answers "where did this actually happen".
private struct TrackMap: View {

    var track: [TrackPoint]
    var flight: Flight
    /// Where the pilot is pointing in the graph, if anywhere.
    var marked: TrackPoint?

    var body: some View {
        Map(initialPosition: .region(region)) {
            MapPolyline(coordinates: coordinates)
                .stroke(.orange, lineWidth: 3)
            if let marked {
                Annotation("", coordinate: CLLocationCoordinate2D(latitude: marked.lat, longitude: marked.lon)) {
                    ZStack {
                        Circle().fill(.white).frame(width: 15, height: 15)
                        Circle().fill(.orange).frame(width: 9, height: 9)
                    }
                    .shadow(radius: 2)
                    .accessibilityLabel("Vybraný okamžik letu")
                }
            }
            Marker("Vzlet", systemImage: "airplane.departure", coordinate: coordinate(flight.takeoff))
                .tint(.green)
            if let landing = current.landing {
                Marker("Přistání", systemImage: "airplane.arrival", coordinate: coordinate(landing))
                    .tint(.blue)
            }
        }
    }

    private var coordinates: [CLLocationCoordinate2D] {
        track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
    }

    private func coordinate(_ event: FlightEvent) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: event.latitude, longitude: event.longitude)
    }

    private var region: MKCoordinateRegion {
        let lats = track.map(\.lat)
        let lons = track.map(\.lon)
        guard let minLat = lats.min(), let maxLat = lats.max(),
              let minLon = lons.min(), let maxLon = lons.max() else {
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: flight.takeoff.latitude, longitude: flight.takeoff.longitude),
                span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
            )
        }
        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2),
            span: MKCoordinateSpan(
                latitudeDelta: max(0.01, (maxLat - minLat) * 1.3),
                longitudeDelta: max(0.01, (maxLon - minLon) * 1.3)
            )
        )
    }
}

/// Plain UIActivityViewController wrapper — SwiftUI's ShareLink cannot hand off
/// a file URL that was written moments ago without a Transferable dance.
struct ShareSheet: UIViewControllerRepresentable {
    var url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}


/// Aircraft registration and a free-text note — the two things the app cannot
/// work out for itself.
private struct FlightEditor: View {

    var flight: Flight
    var onSave: (Flight) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var aircraft: String
    @State private var note: String
    @State private var isTouchAndGo: Bool

    init(flight: Flight, onSave: @escaping (Flight) -> Void) {
        self.flight = flight
        self.onSave = onSave
        _aircraft = State(initialValue: flight.aircraft ?? "")
        _note = State(initialValue: flight.note ?? "")
        _isTouchAndGo = State(initialValue: flight.isTouchAndGo)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Letadlo") {
                    TextField("OK-ABC", text: $aircraft)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }
                Section {
                    TextField("Co si o tom letu chceš pamatovat", text: $note, axis: .vertical)
                        .lineLimit(3...8)
                } header: {
                    Text("Poznámka")
                }
                Section {
                    Toggle("Touch and go", isOn: $isTouchAndGo)
                } footer: {
                    Text("Aplikace si to označí sama, když přistání a další vzlet dělí méně než minuta. Tady se to dá opravit.")
                }
            }
            .navigationTitle("Upravit let")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zavřít") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Uložit") {
                        var updated = flight
                        updated.aircraft = aircraft.isEmpty ? nil : aircraft
                        updated.note = note.isEmpty ? nil : note
                        updated.isTouchAndGo = isTouchAndGo
                        onSave(updated)
                        dismiss()
                    }
                }
            }
        }
    }
}
