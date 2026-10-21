import SwiftUI

/// A vertical scale with the live value pinned in the middle — the speed and
/// altitude tapes of a primary flight display.
///
/// Eight steps are visible at once. The figure under the pointer is the value
/// itself; the figures on the scale are the steps either side of it, so the
/// tape reads as a range, not a single number.
struct Tape: View {

    var value: Double?
    var step: Double
    var accent: Color
    var label: (Double) -> String

    var body: some View {
        GeometryReader { geo in
            let height = geo.size.height
            let perStep = height / 8
            ZStack {
                if let value {
                    let centre = (value / step).rounded(.down) * step
                    ForEach(-5...5, id: \.self) { k in
                        let v = centre + Double(k) * step
                        let y = height / 2 - (v - value) / step * perStep
                        Text(label(v))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .position(x: geo.size.width - 18, y: y)
                    }
                    Text(label(value))
                        .font(.system(size: 19, weight: .bold, design: .rounded).monospacedDigit())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                        .background(accent.opacity(0.2), in: RoundedRectangle(cornerRadius: 6))
                        .position(x: geo.size.width / 2 - 6, y: height / 2)
                } else {
                    Text("—")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .position(x: geo.size.width / 2 - 6, y: height / 2)
                }
            }
            .frame(width: geo.size.width, height: height)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

/// Vertical speed as a bar either side of zero, full scale at ±1500 fpm.
struct VerticalSpeedIndicator: View {

    var fpm: Double?
    var fullScale: Double = 1500

    var body: some View {
        GeometryReader { geo in
            let half = geo.size.height / 2
            let value = fpm ?? 0
            let length = min(1, abs(value) / fullScale) * half
            ZStack {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.primary.opacity(0.04))
                Rectangle()
                    .fill(Color.primary.opacity(0.35))
                    .frame(height: 1)
                Rectangle()
                    .fill(value >= 0 ? Color.green : Color.red)
                    .frame(width: geo.size.width - 8, height: length)
                    .offset(y: value >= 0 ? -length / 2 : length / 2)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .overlay(alignment: .bottom) {
            Text(fpm.map { "\(Int($0.rounded()))" } ?? "—")
                .font(.caption2.monospacedDigit().weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)
        }
    }
}
