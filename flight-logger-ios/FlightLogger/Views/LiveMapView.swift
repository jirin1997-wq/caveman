import MapKit
import SwiftUI

extension Coordinate {
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

extension TrackPoint {
    var clCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
}

/// The track being drawn as it is recorded.
///
/// One thing to be clear about: Apple's map tiles need a network. In the air
/// there usually isn't one, so expect a blank grid — but the track still draws
/// on it, because the line comes from the recorder, not from the map. Anything
/// the phone cached on the ground stays available.
struct LiveTrackMap: View {

    var track: [TrackPoint]
    var follow: Bool
    /// Marks where the flight started, once there is a flight.
    var departure: Coordinate?

    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        Map(position: $camera) {
            if track.count > 1 {
                MapPolyline(coordinates: track.map(\.clCoordinate))
                    .stroke(.orange, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            }
            if let departure {
                Marker("Vzlet", systemImage: "airplane.departure", coordinate: departure.clCoordinate)
                    .tint(.green)
            }
            if let last = track.last {
                Annotation("", coordinate: last.clCoordinate) {
                    ZStack {
                        Circle().fill(.orange.opacity(0.25)).frame(width: 26, height: 26)
                        Circle().fill(.orange).frame(width: 11, height: 11)
                        Circle().strokeBorder(.white, lineWidth: 2).frame(width: 11, height: 11)
                    }
                    .accessibilityLabel("Aktuální poloha")
                }
            }
        }
        .mapStyle(.standard(elevation: .flat))
        .onChange(of: track.last?.t) {
            guard follow, let last = track.last else { return }
            camera = .region(
                MKCoordinateRegion(
                    center: last.clCoordinate,
                    span: MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03)
                )
            )
        }
    }
}

/// The live map at full size, with the numbers that matter laid over it.
struct LiveMapView: View {

    @EnvironmentObject private var recorder: FlightRecorder
    @State private var follow = true

    var body: some View {
        ZStack(alignment: .top) {
            LiveTrackMap(
                track: recorder.liveTrack.points,
                follow: follow,
                departure: recorder.currentFlight?.takeoff.coordinate
            )
            .ignoresSafeArea(edges: .bottom)

            HStack(spacing: 10) {
                overlay("GS", Units.knotsLabel(recorder.snapshot.speed >= 0 ? recorder.snapshot.speed : nil))
                overlay("AGL", Units.feetLabel(recorder.snapshot.agl))
                overlay("V/S", Units.fpmLabel(recorder.snapshot.climbRate))
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
        .navigationTitle("Trasa")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    follow.toggle()
                } label: {
                    Label(
                        follow ? "Sledování zapnuté" : "Sledovat",
                        systemImage: follow ? "location.fill" : "location"
                    )
                }
            }
        }
    }

    private func overlay(_ title: String, _ value: String) -> some View {
        VStack(spacing: 1) {
            Text(title)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 16, weight: .bold, design: .rounded).monospacedDigit())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
    }
}
