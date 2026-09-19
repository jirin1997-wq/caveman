import SwiftUI

/// Ground speed, vertical speed and height above terrain on one shared time
/// axis.
///
/// Three lanes rather than one chart with three scales: a knot, a foot per
/// minute and a foot have nothing to do with each other, and stacking them
/// keeps every line readable against its own range while the x axis still lets
/// you line up "the climb started here" with "the speed dropped there".
///
/// Drawn with `Canvas` because a thinned track is still up to 1500 points per
/// lane, and a SwiftUI `Path` per point would redraw far more than it shows.
struct FlightGraph: View {

    var points: [TrackPoint]
    /// Marks a moment on the axis — the playhead while a flight is live, or
    /// whatever the pilot is currently pointing at.
    var highlight: Date?
    var laneHeight: CGFloat = 54
    /// Set to make the lanes scrubbable. Dragging reports the moment under the
    /// finger, which is what lets the map show where the aircraft was when the
    /// climb started.
    var onScrub: ((Date) -> Void)?

    private struct Lane {
        var title: String
        var unit: String
        var color: Color
        /// Nil for points where this quantity is unknown; the line breaks there.
        var value: (TrackPoint) -> Double?
        /// Draw a rule at this value — zero, for vertical speed.
        var baseline: Double?
        var fill: Bool
    }

    private var lanes: [Lane] {
        [
            Lane(title: "RYCHLOST", unit: "kt", color: .blue,
                 value: { Units.mpsToKnots(max(0, $0.spd)) }, baseline: nil, fill: false),
            Lane(title: "STOUPÁNÍ", unit: "fpm", color: .purple,
                 value: { $0.vs.map { v in Units.mpsToFpm(v) } }, baseline: 0, fill: false),
            Lane(title: "NAD ZEMÍ", unit: "ft", color: .orange,
                 value: { $0.agl.map { a in Units.metersToFeet(a) } }, baseline: nil, fill: true)
        ]
    }

    var body: some View {
        if points.count < 2 {
            Text("Graf se kreslí od druhého bodu trasy.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(lanes.enumerated()), id: \.offset) { _, lane in
                    laneView(lane)
                }
            }
        }
    }

    /// While something is highlighted the lane reads out that moment, not the
    /// end of the flight — otherwise scrubbing would move a line and change
    /// nothing you could read.
    private func displayed(_ lane: Lane, values: [Double?]) -> Double? {
        guard let highlight, let index = indexNearest(to: highlight) else {
            return values.last ?? nil
        }
        return values[index]
    }

    private func indexNearest(to time: Date) -> Int? {
        guard !points.isEmpty else { return nil }
        var best = 0
        var bestGap = Double.greatestFiniteMagnitude
        for (index, point) in points.enumerated() {
            let gap = abs(point.t.timeIntervalSince(time))
            if gap < bestGap { bestGap = gap; best = index }
        }
        return best
    }

    /// Turns a horizontal position into a moment on the shared time axis.
    @ViewBuilder
    private var scrubLayer: some View {
        if let onScrub, let first = points.first?.t, let last = points.last?.t {
            GeometryReader { geometry in
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                let fraction = min(1, max(0, value.location.x / max(1, geometry.size.width)))
                                onScrub(first.addingTimeInterval(last.timeIntervalSince(first) * fraction))
                            }
                    )
            }
        }
    }

    private func laneView(_ lane: Lane) -> some View {
        let values = points.map(lane.value)
        let known = values.compactMap { $0 }
        let lo = min(known.min() ?? 0, lane.baseline ?? .greatestFiniteMagnitude)
        let hi = max(known.max() ?? 1, lane.baseline ?? -.greatestFiniteMagnitude)

        return VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline) {
                Text(lane.title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(displayed(lane, values: values).map { "\(Int($0.rounded())) \(lane.unit)" } ?? "—")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(lane.color)
            }

            Canvas { context, size in
                draw(lane: lane, values: values, lo: lo, hi: hi, in: context, size: size)
            }
            .frame(height: laneHeight)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            .overlay { scrubLayer }
            .accessibilityLabel(
                "\(lane.title): od \(Int(lo.rounded())) do \(Int(hi.rounded())) \(lane.unit)"
            )

            HStack {
                Text("\(Int(lo.rounded()))")
                Spacer()
                Text("\(Int(hi.rounded())) \(lane.unit)")
            }
            .font(.system(size: 9).monospacedDigit())
            .foregroundStyle(.tertiary)
        }
    }

    private func draw(
        lane: Lane,
        values: [Double?],
        lo: Double,
        hi: Double,
        in context: GraphicsContext,
        size: CGSize
    ) {
        guard let first = points.first?.t, let last = points.last?.t else { return }
        let span = max(1, last.timeIntervalSince(first))
        let range = max(1e-6, hi - lo)
        let inset: CGFloat = 4

        func x(_ t: Date) -> CGFloat {
            CGFloat(t.timeIntervalSince(first) / span) * size.width
        }
        func y(_ v: Double) -> CGFloat {
            size.height - inset - CGFloat((v - lo) / range) * (size.height - inset * 2)
        }

        if let baseline = lane.baseline, baseline >= lo, baseline <= hi {
            var rule = Path()
            rule.move(to: CGPoint(x: 0, y: y(baseline)))
            rule.addLine(to: CGPoint(x: size.width, y: y(baseline)))
            context.stroke(rule, with: .color(.secondary.opacity(0.45)),
                           style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }

        // One path per unbroken run, so a gap in the data reads as a gap.
        var line = Path()
        var area = Path()
        var drawing = false
        for (index, value) in values.enumerated() {
            guard let value else { drawing = false; continue }
            let point = CGPoint(x: x(points[index].t), y: y(value))
            if drawing {
                line.addLine(to: point)
                area.addLine(to: point)
            } else {
                line.move(to: point)
                area.move(to: CGPoint(x: point.x, y: size.height))
                area.addLine(to: point)
                drawing = true
            }
        }

        if lane.fill, let lastKnown = values.lastIndex(where: { $0 != nil }) {
            area.addLine(to: CGPoint(x: x(points[lastKnown].t), y: size.height))
            area.closeSubpath()
            context.fill(area, with: .color(lane.color.opacity(0.16)))
        }

        context.stroke(line, with: .color(lane.color),
                       style: StrokeStyle(lineWidth: 1.6, lineJoin: .round))

        if let highlight {
            var mark = Path()
            mark.move(to: CGPoint(x: x(highlight), y: 0))
            mark.addLine(to: CGPoint(x: x(highlight), y: size.height))
            context.stroke(mark, with: .color(.primary.opacity(0.35)), lineWidth: 1)

            // A dot where the line actually is, so the reading above the lane
            // has something to point at.
            if let index = indexNearest(to: highlight), let value = values[index] {
                let dot = CGRect(x: x(points[index].t) - 3, y: y(value) - 3, width: 6, height: 6)
                context.fill(Path(ellipseIn: dot), with: .color(lane.color))
            }
        }
    }
}
