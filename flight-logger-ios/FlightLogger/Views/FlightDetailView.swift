import MapKit
import SwiftUI
import UIKit

struct FlightDetailView: View {

    var flight: Flight

    @EnvironmentObject private var store: FlightStore
    @State private var track: [TrackPoint] = []
    @State private var shareURL: URL?

    var body: some View {
        List {
            if !track.isEmpty {
                Section {
                    TrackMap(track: track, flight: flight)
                        .frame(height: 240)
                        .listRowInsets(EdgeInsets())
                }
            }

            Section("Souhrn") {
                row("Vzlet", flight.takeoff.time.formatted(date: .abbreviated, time: .standard))
                row("Přistání", flight.landing.map { $0.time.formatted(date: .abbreviated, time: .standard) } ?? "—")
                row("Doba letu", Units.durationLabel(flight.duration))
                row("Odlet", flight.departureLabel)
                row("Přílet", flight.arrivalLabel)
                row("Letadlo", flight.aircraft ?? "—")
                row("Max. výška MSL", Units.feetLabel(flight.maxAltitude))
                row("Max. nad zemí", Units.feetLabel(flight.maxAGL))
                row("Max. rychlost", Units.knotsLabel(flight.maxSpeed))
                row("Uletěno", Units.distanceLabel(flight.distance))
            }

            Section("Detekce") {
                eventRow(flight.takeoff)
                if let landing = flight.landing {
                    eventRow(landing)
                }
            }

            Section {
                Button {
                    shareURL = store.exportGPX(flight)
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

    var body: some View {
        Map(initialPosition: .region(region)) {
            MapPolyline(coordinates: coordinates)
                .stroke(.orange, lineWidth: 3)
            Marker("Vzlet", systemImage: "airplane.departure", coordinate: coordinate(flight.takeoff))
                .tint(.green)
            if let landing = flight.landing {
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
