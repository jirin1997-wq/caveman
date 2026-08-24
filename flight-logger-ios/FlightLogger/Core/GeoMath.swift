import Foundation

enum GeoMath {
    static let earthRadius: Double = 6_371_008.8

    /// Great-circle distance in meters.
    static func distance(_ a: Coordinate, _ b: Coordinate) -> Double {
        let phi1 = a.latitude * .pi / 180
        let phi2 = b.latitude * .pi / 180
        let dPhi = (b.latitude - a.latitude) * .pi / 180
        let dLambda = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dPhi / 2) * sin(dPhi / 2)
            + cos(phi1) * cos(phi2) * sin(dLambda / 2) * sin(dLambda / 2)
        return 2 * earthRadius * asin(min(1, sqrt(h)))
    }

    /// Offsets a coordinate by a north/east distance in meters. Used by the
    /// synthetic track generator and by the tests.
    static func offset(_ c: Coordinate, north: Double, east: Double) -> Coordinate {
        let dLat = north / earthRadius * 180 / .pi
        let dLon = east / (earthRadius * cos(c.latitude * .pi / 180)) * 180 / .pi
        return Coordinate(latitude: c.latitude + dLat, longitude: c.longitude + dLon)
    }

    /// Least-squares slope of y over x. Returns nil for fewer than two points or
    /// a degenerate (zero-variance) x.
    ///
    /// Used for climb rate: fitting a line through the altitude samples of the
    /// last few seconds is far steadier than differencing two fixes, which is
    /// dominated by GPS vertical noise.
    static func slope(x: [Double], y: [Double]) -> Double? {
        guard x.count == y.count, x.count >= 2 else { return nil }
        let n = Double(x.count)
        let meanX = x.reduce(0, +) / n
        let meanY = y.reduce(0, +) / n
        var num = 0.0
        var den = 0.0
        for i in 0..<x.count {
            let dx = x[i] - meanX
            num += dx * (y[i] - meanY)
            den += dx * dx
        }
        guard den > 1e-9 else { return nil }
        return num / den
    }

    /// Median. Resistant to the single wild altitude spike a GPS throws every
    /// few minutes, which is exactly why the ground reference uses it.
    static func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let mid = sorted.count / 2
        if sorted.count % 2 == 1 { return sorted[mid] }
        return (sorted[mid - 1] + sorted[mid]) / 2
    }
}

// MARK: - Units

/// Aviation units live only at the display edge. Everything inside the app is SI.
enum Units {
    static let metersPerFoot = 0.3048
    static let metersPerSecondPerKnot = 0.514444

    static func metersToFeet(_ m: Double) -> Double { m / metersPerFoot }
    static func feetToMeters(_ ft: Double) -> Double { ft * metersPerFoot }
    static func mpsToKnots(_ mps: Double) -> Double { mps / metersPerSecondPerKnot }
    static func knotsToMps(_ kt: Double) -> Double { kt * metersPerSecondPerKnot }
    /// Meters per second to feet per minute — the vertical speed unit on every
    /// light-aircraft VSI.
    static func mpsToFpm(_ mps: Double) -> Double { metersToFeet(mps) * 60 }

    static func feetLabel(_ meters: Double?) -> String {
        guard let meters else { return "—" }
        return "\(Int(metersToFeet(meters).rounded())) ft"
    }

    static func knotsLabel(_ mps: Double?) -> String {
        guard let mps, mps >= 0 else { return "—" }
        return "\(Int(mpsToKnots(mps).rounded())) kt"
    }

    static func fpmLabel(_ mps: Double?) -> String {
        guard let mps else { return "—" }
        let v = Int(mpsToFpm(mps).rounded())
        return v > 0 ? "+\(v) fpm" : "\(v) fpm"
    }

    static func distanceLabel(_ meters: Double) -> String {
        let nm = meters / 1852
        return String(format: "%.1f NM", nm)
    }

    static func durationLabel(_ seconds: TimeInterval?) -> String {
        guard let seconds, seconds >= 0 else { return "—" }
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 3600, (total % 3600) / 60)
    }

    static func coordinateLabel(_ c: Coordinate) -> String {
        String(format: "%.4f, %.4f", c.latitude, c.longitude)
    }
}
