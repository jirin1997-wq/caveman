import CoreLocation
import MapKit
import SwiftUI

/// Serves map tiles from the phone first, the network second, and nothing at
/// all when neither has them.
///
/// This is what makes the map work in the air. Apple's own tiles need a
/// connection and there isn't one above a thousand feet, so when the pilot has
/// downloaded a region this overlay replaces Apple's base map entirely with
/// pictures that are already on the phone.
final class OfflineTileOverlay: MKTileOverlay {

    private let files: TileFiles
    private let source: TileSource
    /// False in the air, or whenever the pilot would rather not spend data on
    /// tiles that are not already stored.
    private let allowsNetwork: Bool

    init(source: TileSource, files: TileFiles, allowsNetwork: Bool) {
        self.source = source
        self.files = files
        self.allowsNetwork = allowsNetwork
        super.init(urlTemplate: nil)
        tileSize = CGSize(width: 256, height: 256)
        // Apple's base map would only show a blank grid offline, so it goes.
        canReplaceMapContent = true
        minimumZ = source.minZoom
        maximumZ = source.maxZoom
    }

    override func loadTile(at path: MKTileOverlayPath, result: @escaping (Data?, Error?) -> Void) {
        let tile = Tile(z: path.z, x: path.x, y: path.y)

        if let stored = files.data(for: tile) {
            result(stored, nil)
            return
        }

        guard allowsNetwork, let url = source.url(for: tile) else {
            // Nothing to draw. Not an error — a gap in an offline map is a
            // normal thing to look at, and MapKit leaves it blank.
            result(nil, nil)
            return
        }

        var request = URLRequest(url: url)
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 15

        let files = self.files
        URLSession.shared.dataTask(with: request) { data, response, error in
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let data, !data.isEmpty, (200..<300).contains(code) else {
                result(nil, error)
                return
            }
            // Browsing fills the cache too, so flying over somewhere you looked
            // at on the ground already works.
            files.store(data, for: tile)
            result(data, nil)
        }.resume()
    }

    private static let userAgent =
        "LetovyZapisovac/1.0 (offline flight-logger map cache; contact via app settings)"
}

/// The map every screen draws on.
///
/// `MKMapView` rather than SwiftUI's `Map`, because only the UIKit one takes a
/// custom tile overlay — which is the entire point of having offline maps.
/// With no tile source configured it is an ordinary Apple map.
struct TileMapView: UIViewRepresentable {

    var track: [TrackPoint]
    var source: TileSource?
    var files: TileFiles
    var allowsNetwork: Bool
    /// Keeps the aircraft centred as fixes arrive.
    var follow: Bool
    var departure: Coordinate?
    var arrival: Coordinate?
    /// The moment the pilot is pointing at in the graph.
    var marked: Coordinate?
    /// Set once for a finished flight; nil while recording.
    var staticRegion: MKCoordinateRegion?
    /// The Direct-to field. Drawn dashed from the last track point.
    var target: Coordinate? = nil

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        map.showsCompass = true
        map.showsScale = true
        if let staticRegion { map.setRegion(staticRegion, animated: false) }
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.apply(source: source, files: files, allowsNetwork: allowsNetwork, to: map)
        context.coordinator.apply(track: track, to: map)
        context.coordinator.apply(departure: departure, arrival: arrival, marked: marked, to: map)
        context.coordinator.apply(target: target, from: track.last, to: map)

        if follow, let last = track.last {
            let centre = CLLocationCoordinate2D(latitude: last.lat, longitude: last.lon)
            if context.coordinator.shouldRecentre(on: centre, in: map) {
                map.setRegion(
                    MKCoordinateRegion(
                        center: centre,
                        span: map.region.span.latitudeDelta > 0.0001
                            ? map.region.span
                            : MKCoordinateSpan(latitudeDelta: 0.03, longitudeDelta: 0.03)
                    ),
                    animated: true
                )
            }
        }
    }

    final class Coordinator: NSObject, MKMapViewDelegate {

        private var overlayKey: String?
        private var tileOverlay: MKTileOverlay?
        private var polyline: MKPolyline?
        private var trackCount = 0
        private var lastCentre: CLLocationCoordinate2D?

        /// Rebuilds the tile overlay only when the source actually changed —
        /// replacing it on every update would re-request every visible tile.
        func apply(source: TileSource?, files: TileFiles, allowsNetwork: Bool, to map: MKMapView) {
            let key = source.map { "\($0.id)|\($0.urlTemplate)|\(allowsNetwork)" } ?? "apple"
            guard key != overlayKey else { return }
            overlayKey = key

            if let existing = tileOverlay {
                map.removeOverlay(existing)
                tileOverlay = nil
            }
            guard let source, source.isUsable else { return }
            let overlay = OfflineTileOverlay(source: source, files: files, allowsNetwork: allowsNetwork)
            map.insertOverlay(overlay, at: 0, level: .aboveLabels)
            tileOverlay = overlay
        }

        func apply(track: [TrackPoint], to map: MKMapView) {
            guard track.count != trackCount else { return }
            trackCount = track.count
            if let existing = polyline {
                map.removeOverlay(existing)
                polyline = nil
            }
            guard track.count > 1 else { return }
            let line = MKPolyline(
                coordinates: track.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) },
                count: track.count
            )
            map.addOverlay(line, level: .aboveLabels)
            polyline = line
        }

        private var directLine: MKPolyline?

        /// A dashed line from the aircraft to the Direct-to field, replaced
        /// whenever either end moves.
        func apply(target: Coordinate?, from here: TrackPoint?, to map: MKMapView) {
            if let directLine {
                map.removeOverlay(directLine)
                self.directLine = nil
            }
            guard let target, let here else { return }
            var coords = [
                CLLocationCoordinate2D(latitude: here.lat, longitude: here.lon),
                CLLocationCoordinate2D(latitude: target.latitude, longitude: target.longitude),
            ]
            let line = MKPolyline(coordinates: &coords, count: coords.count)
            line.title = "direct"
            map.addOverlay(line, level: .aboveLabels)
            directLine = line
        }

        func apply(
            departure: Coordinate?,
            arrival: Coordinate?,
            marked: Coordinate?,
            to map: MKMapView
        ) {
            map.removeAnnotations(map.annotations)
            var pins: [MKPointAnnotation] = []
            if let departure { pins.append(pin(departure, "Vzlet")) }
            if let arrival { pins.append(pin(arrival, "Přistání")) }
            if let marked { pins.append(pin(marked, "Vybraný okamžik")) }
            map.addAnnotations(pins)
        }

        private func pin(_ c: Coordinate, _ title: String) -> MKPointAnnotation {
            let pin = MKPointAnnotation()
            pin.coordinate = CLLocationCoordinate2D(latitude: c.latitude, longitude: c.longitude)
            pin.title = title
            return pin
        }

        /// Don't fight the map: re-centre only once the aircraft has actually
        /// moved, so a pilot reading the map is not yanked back every second.
        func shouldRecentre(on centre: CLLocationCoordinate2D, in map: MKMapView) -> Bool {
            defer { lastCentre = centre }
            guard let previous = lastCentre else { return true }
            let moved = abs(previous.latitude - centre.latitude) > 0.0002
                || abs(previous.longitude - centre.longitude) > 0.0002
            return moved
        }

        func mapView(_ map: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let tiles = overlay as? MKTileOverlay {
                return MKTileOverlayRenderer(tileOverlay: tiles)
            }
            if let line = overlay as? MKPolyline {
                let renderer = MKPolylineRenderer(polyline: line)
                if line.title == "direct" {
                    renderer.strokeColor = UIColor.systemBlue
                    renderer.lineWidth = 2
                    renderer.lineDashPattern = [8, 6]
                } else {
                    renderer.strokeColor = UIColor.systemOrange
                    renderer.lineWidth = 3
                    renderer.lineJoin = .round
                    renderer.lineCap = .round
                }
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
        }

        func mapView(_ map: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard !(annotation is MKUserLocation) else { return nil }
            let id = "pin"
            let view = map.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView
                ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
            view.annotation = annotation
            switch annotation.title ?? nil {
            case "Vzlet":
                view.markerTintColor = .systemGreen
                view.glyphImage = UIImage(systemName: "airplane.departure")
            case "Přistání":
                view.markerTintColor = .systemBlue
                view.glyphImage = UIImage(systemName: "airplane.arrival")
            default:
                view.markerTintColor = .systemOrange
                view.glyphImage = UIImage(systemName: "mappin")
            }
            view.displayPriority = .required
            return view
        }
    }
}

/// The line every tile provider requires under their map.
struct MapAttribution: View {
    var source: TileSource?

    var body: some View {
        if let source, source.isUsable, !source.attribution.isEmpty {
            Text(source.attribution)
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 4))
        }
    }
}
