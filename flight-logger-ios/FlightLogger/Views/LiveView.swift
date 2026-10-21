import CoreLocation
import SwiftUI

/// The in-flight screen, laid out after a primary flight display and a
/// multifunction display: the aircraft's numbers on tapes at the edges, the map
/// in the middle, and a fixed row of operator keys along the foot.
///
/// On an iPhone the parts stack; on an iPad they sit in three columns. The keys
/// stay in the same place in both, as they do on the Garmin AXIS panels.
struct LiveView: View {

    @EnvironmentObject private var recorder: FlightRecorder
    @EnvironmentObject private var location: LocationService
    @Environment(\.horizontalSizeClass) private var sizeClass

    @State private var presented: Sheet?

    enum Sheet: String, Identifiable {
        case emergency, direct, menu
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack {
            Group {
                if sizeClass == .regular {
                    wideLayout
                } else {
                    narrowLayout
                }
            }
            .safeAreaInset(edge: .bottom) { keyBar }
            .navigationTitle(L10n.t("Letový zapisovač"))
            .navigationBarTitleDisplayMode(.inline)
            .sheet(item: $presented) { item in
                switch item {
                case .emergency: EmergencySheet()
                case .direct: DirectSheet()
                case .menu: MenuSheet()
                }
            }
        }
    }

    // MARK: - Layouts

    private var narrowLayout: some View {
        ScrollView {
            VStack(spacing: 12) {
                permissionNotice
                phaseHeader
                HStack(alignment: .top, spacing: 8) {
                    speedTape.frame(width: 70)
                    verticalSpeed.frame(width: 26)
                    altitudeTape.frame(width: 92)
                }
                .frame(height: 240)
                directBar
                mapCard(fill: false)
                if showsApron { apronCard }
                graphCard
                terrainCard
                sensorCard
                if let flight = recorder.currentFlight { flightCard(flight) }
                if let event = recorder.lastEvent { eventCard(event) }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
    }

    private var wideLayout: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 10) {
                phaseHeader
                HStack(alignment: .top, spacing: 8) {
                    speedTape.frame(width: 84)
                    verticalSpeed.frame(width: 30)
                    altitudeTape.frame(width: 100)
                }
                .frame(height: 380)
                if showsApron { apronCard }
                Spacer(minLength: 0)
            }
            .frame(width: 330)

            VStack(spacing: 12) {
                directBar
                mapCard(fill: true)
                graphCard
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            ScrollView {
                VStack(spacing: 12) {
                    permissionNotice
                    terrainCard
                    sensorCard
                    if let flight = recorder.currentFlight { flightCard(flight) }
                    if let event = recorder.lastEvent { eventCard(event) }
                }
            }
            .frame(width: 320)
        }
        .padding()
    }

    // MARK: - Tapes

    private var speedKt: Double? {
        recorder.snapshot.speed >= 0 ? Units.mpsToKnots(recorder.snapshot.speed) : nil
    }

    private var altitudeFt: Double? {
        recorder.snapshot.altitude.map(Units.metersToFeet)
    }

    private var climbFpm: Double? {
        recorder.snapshot.climbRate.map(Units.mpsToFpm)
    }

    private var speedTape: some View {
        Tape(value: speedKt, step: 10, accent: .blue) { "\(Int($0.rounded()))" }
            .overlay(alignment: .topLeading) { tapeName("SPEED") }
    }

    private var altitudeTape: some View {
        Tape(value: altitudeFt, step: 100, accent: .green) { "\(Int($0.rounded()))" }
            .overlay(alignment: .topLeading) { tapeName("ALT MSL") }
    }

    private var verticalSpeed: some View {
        VerticalSpeedIndicator(fpm: climbFpm)
    }

    private func tapeName(_ title: String) -> some View {
        Text(L10n.t(title))
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.secondary)
            .padding(4)
    }

    // MARK: - Header and direct-to

    private var phaseHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L10n.t(recorder.snapshot.phase.label))
                .font(.system(size: 26, weight: .heavy, design: .rounded))
                .foregroundStyle(phaseColor)
            if recorder.snapshot.candidateProgress > 0 && recorder.snapshot.candidateProgress < 1 {
                ProgressView(value: recorder.snapshot.candidateProgress)
                    .tint(phaseColor)
                Text(L10n.t("ověřuji změnu stavu…"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(phaseColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }

    private var phaseColor: Color {
        switch recorder.snapshot.phase {
        case .unknown: return .gray
        case .onGround: return .blue
        case .taxi: return .teal
        case .takeoffRoll: return .orange
        case .airborne: return .green
        case .approach: return .orange
        }
    }

    /// The Direct-to line: target, bearing, distance and, when moving, the time
    /// to it at the current ground speed. Tapping it opens DIRECT.
    private var directBar: some View {
        Button {
            presented = .direct
        } label: {
            HStack(spacing: 10) {
                if let target = recorder.directTarget, let nav = recorder.directNavigation {
                    Text(target.code)
                        .font(.headline)
                    Text("\(L10n.t("Kurz")) \(String(format: "%03.0f°", nav.bearing))")
                        .font(.subheadline.monospacedDigit())
                    Text(String(format: "%.1f NM", nav.distance / 1852))
                        .font(.subheadline.monospacedDigit())
                    if let kt = speedKt, kt > 3 {
                        Text("\(L10n.t("Odhad")) \(Units.durationLabel(nav.distance / Units.knotsToMps(kt)))")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                } else {
                    Text(L10n.t("Direct-to: bez cíle — klepni pro výběr letiště"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                }
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Map, graph and the aircraft on the apron

    private func mapCard(fill: Bool) -> some View {
        NavigationLink {
            LiveMapView()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                LiveTrackMap(
                    track: recorder.liveTrack.points,
                    follow: true,
                    departure: recorder.currentFlight?.takeoff.coordinate,
                    target: recorder.directTarget?.coordinate
                )
                .frame(maxWidth: .infinity)
                .frame(minHeight: 230, maxHeight: fill ? .infinity : 230)
                .allowsHitTesting(false)

                HStack {
                    Label(L10n.t("Trasa"), systemImage: "map")
                    Spacer()
                    Text(trackSummary)
                    Image(systemName: "chevron.right").font(.caption2)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
            }
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .frame(maxHeight: fill ? .infinity : nil)
        }
        .buttonStyle(.plain)
    }

    private var trackSummary: String {
        let count = recorder.liveTrack.points.count
        guard count > 1 else { return L10n.t("čekám na fixy") }
        guard let flight = recorder.currentFlight else { return "\(count) \(L10n.t("bodů"))" }
        return "\(count) \(L10n.t("bodů")) · \(Units.distanceLabel(flight.distance))"
    }

    private var graphCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L10n.t("PRŮBĚH LETU"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            FlightGraph(points: recorder.liveTrack.points)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    /// Shown while the aircraft is on the surface: a 3D view of where it points.
    private var showsApron: Bool {
        let phase = recorder.snapshot.phase
        return phase == .onGround || phase == .taxi || phase == .takeoffRoll
    }

    private var apronCard: some View {
        let track: Double? = location.lastFix.flatMap { fix -> Double? in
            fix.course >= 0 ? fix.course : nil
        }
        return VStack(alignment: .leading, spacing: 6) {
            Text(L10n.t("Letadlo na stanovišti"))
                .font(.subheadline.weight(.semibold))
            AircraftView(track: track, groundSpeed: max(0, recorder.snapshot.speed))
                .frame(height: 200)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
            Text(L10n.t("Pohled na letadlo se točí podle kurzu z GPS."))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Cards

    private var permissionNotice: some View {
        Group {
            if location.authorization == .authorizedWhenInUse {
                Text(L10n.t("Povolení je jen „Při používání“ — se zhasnutým displejem se nezaznamenává. V Nastavení iOS přepni na „Vždy“."))
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
            }
            if location.authorization == .denied || location.authorization == .restricted {
                Text(L10n.t("Poloha je zakázaná. Bez ní aplikace nic nezaznamená — povol ji v Nastavení iOS."))
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var terrainCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(L10n.t("Terén pod letadlem"), systemImage: "mountain.2")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(recorder.elevation?.source.label ?? "—")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(terrainColor.opacity(0.18), in: Capsule())
                    .foregroundStyle(terrainColor)
            }
            Text(recorder.elevation.map { "\(Int($0.meters.rounded())) m n. m. (\(Units.feetLabel($0.meters)))" }
                 ?? L10n.t("Bez údaje o terénu — detekce jede jen podle rychlosti a stoupání."))
                .font(.callout)
                .foregroundStyle(.secondary)
            if let airport = recorder.nearestAirport {
                Text("\(L10n.t("Nejbližší letiště:")) \(airport.code) — \(airport.name)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    private var terrainColor: Color {
        guard let source = recorder.elevation?.source else { return .gray }
        return source.rank >= ElevationSource.airport.rank ? .green : .orange
    }

    private var sensorCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(L10n.t("Senzory telefonu"), systemImage: "gauge.with.dots.needle.bottom.50percent")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(L10n.t(recorder.motionService.hasBarometer ? "barometr" : "bez barometru"))
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.secondary.opacity(0.15), in: Capsule())
                    .foregroundStyle(.secondary)
            }
            Text(sensorLine)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    private var sensorLine: String {
        if recorder.motionService.baroZeroed {
            let g = recorder.motion.acceleration.map { String(format: "%.2f g", $0) } ?? "—"
            return "\(L10n.t("Výška nad zemí měřená barometrem od poslední zastávky. Zrychlení")) \(g)."
        }
        if recorder.motionService.hasBarometer {
            return L10n.t("Barometr se vynuluje, až letadlo chvíli postojí. Do té doby jede AGL z GPS.")
        }
        return L10n.t("Tento telefon nemá barometr — AGL se počítá z GPS a terénu.")
    }

    private func flightCard(_ flight: Flight) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(L10n.t("Let")) \(Units.durationLabel(context.date.timeIntervalSince(flight.takeoff.time))) · \(Units.distanceLabel(flight.distance))")
                    if let offBlocks = flight.offBlocks {
                        Text("\(L10n.t("Blok")) \(Units.durationLabel(context.date.timeIntervalSince(offBlocks.time))) · \(L10n.t("Pojíždění")) \(Units.durationLabel(flight.taxiOut))")
                    }
                }
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
    }

    private func eventCard(_ event: FlightEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L10n.t("Poslední událost"))
                .font(.subheadline.weight(.semibold))
            Text("\(L10n.t(event.kind.label)) · \(event.time.formatted(date: .omitted, time: .standard))")
                .font(.callout.monospacedDigit())
            Text("\(Units.knotsLabel(event.speed)) · AGL \(Units.feetLabel(event.agl))")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Keys

    /// The fixed operator row: EMER, MENU, record, DIRECT. Same order and place
    /// on both devices.
    private var keyBar: some View {
        HStack(spacing: 8) {
            KeyButton(title: "EMER", tint: .red) { presented = .emergency }
            KeyButton(title: "MENU", tint: .gray) { presented = .menu }
            KeyButton(
                title: recorder.isRecording ? L10n.t("Zastavit") : L10n.t("Záznam"),
                tint: recorder.isRecording ? .red : .green
            ) {
                recorder.isRecording ? recorder.stop() : recorder.start()
            }
            KeyButton(title: "DIRECT", tint: .orange) { presented = .direct }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private struct KeyButton: View {
        var title: String
        var tint: Color
        var action: () -> Void

        var body: some View {
            Button(action: action) {
                Text(title)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .foregroundStyle(tint)
                    .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
        }
    }
}
