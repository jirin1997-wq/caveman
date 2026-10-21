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
/// What is underneath depends on what the pilot set up. With a tile source and
/// a downloaded region it is a real map that works with no signal; with Apple
/// Maps it is a real map on the ground and a blank grid in the air. Either
/// way the orange line is drawn from the recorder, not from the map, so it
/// appears regardless.
struct LiveTrackMap: View {

    var track: [TrackPoint]
    var follow: Bool
    /// Marks where the flight started, once there is a flight.
    var departure: Coordinate?
    var marked: Coordinate?
    /// The Direct-to field, drawn as a dashed line from the aircraft.
    var target: Coordinate? = nil

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var tiles: TileStore

    var body: some View {
        TileMapView(
            track: track,
            source: settings.tileSource,
            files: tiles.files,
            allowsNetwork: settings.downloadTilesWhileBrowsing,
            follow: follow,
            departure: departure,
            arrival: nil,
            marked: marked,
            staticRegion: nil,
            target: target
        )
        .overlay(alignment: .bottomTrailing) {
            MapAttribution(source: settings.tileSource)
                .padding(4)
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
