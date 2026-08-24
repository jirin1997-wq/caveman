import Foundation

/// Terrain lookup against the Open-Meteo elevation API.
///
///     GET https://api.open-meteo.com/v1/elevation?latitude=50.10&longitude=14.26
///     -> { "elevation": [ 380.0 ] }
///
/// Free, no API key, accepts up to 100 coordinates per request. Everything here
/// is best effort: in the air there is usually no cellular signal at all, so a
/// failed lookup must be silent and the app must keep working from the ground
/// reference and the airport database.
struct OnlineElevationClient: Sendable {

    var baseURL = URL(string: "https://api.open-meteo.com/v1/elevation")!
    /// Short on purpose: a request that hangs for a minute over a weak link is
    /// worse than no request at all.
    var timeout: TimeInterval = 8

    private struct Response: Decodable {
        var elevation: [Double]
    }

    func elevation(at coordinate: Coordinate) async -> Double? {
        await elevations(at: [coordinate]).first ?? nil
    }

    /// Batched lookup. Returns one optional per input coordinate, in order.
    func elevations(at coordinates: [Coordinate]) async -> [Double?] {
        guard !coordinates.isEmpty else { return [] }
        let empty: [Double?] = coordinates.map { _ in nil }

        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(
                name: "latitude",
                value: coordinates.map { String(format: "%.5f", $0.latitude) }.joined(separator: ",")
            ),
            URLQueryItem(
                name: "longitude",
                value: coordinates.map { String(format: "%.5f", $0.longitude) }.joined(separator: ",")
            )
        ]
        guard let url = components?.url else { return empty }

        var request = URLRequest(url: url)
        request.timeoutInterval = timeout

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return empty }
            let decoded = try JSONDecoder().decode(Response.self, from: data)
            return coordinates.indices.map { index in
                index < decoded.elevation.count ? decoded.elevation[index] : nil
            }
        } catch {
            return empty
        }
    }
}
