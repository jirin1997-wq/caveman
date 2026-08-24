import CoreLocation
import SwiftUI

/// The in-flight screen: what the detector sees, right now.
///
/// Laid out for a kneeboard — big numbers, no scrolling needed for the ones
/// that matter, and the terrain source always visible so the pilot knows how
/// much to trust the AGL reading.
struct LiveView: View {

    @EnvironmentObject private var recorder: FlightRecorder
    @EnvironmentObject private var location: LocationService

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    phaseBanner
                    readouts
                    terrainCard
                    if let flight = recorder.currentFlight {
                        currentFlightCard(flight)
                    }
                    if let event = recorder.lastEvent {
                        lastEventCard(event)
                    }
                    controls
                }
                .padding()
            }
            .navigationTitle("Letový zapisovač")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Phase

    private var phaseBanner: some View {
        VStack(spacing: 8) {
            Text(recorder.snapshot.phase.label)
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .foregroundStyle(phaseColor)
            if recorder.snapshot.candidateProgress > 0 && recorder.snapshot.candidateProgress < 1 {
                ProgressView(value: recorder.snapshot.candidateProgress)
                    .tint(phaseColor)
                Text("ověřuji změnu stavu…")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background(phaseColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
    }

    private var phaseColor: Color {
        switch recorder.snapshot.phase {
        case .unknown: return .gray
        case .onGround: return .blue
        case .takeoffRoll: return .orange
        case .airborne: return .green
        case .approach: return .orange
        }
    }

    // MARK: - Readouts

    private var readouts: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            Readout(title: "RYCHLOST", value: Units.knotsLabel(recorder.snapshot.speed >= 0 ? recorder.snapshot.speed : nil))
            Readout(title: "VÝŠKA MSL", value: Units.feetLabel(recorder.snapshot.altitude))
            Readout(
                title: "NAD ZEMÍ (AGL)",
                value: Units.feetLabel(recorder.snapshot.agl),
                emphasis: recorder.snapshot.agl != nil
            )
            Readout(title: "STOUPÁNÍ", value: Units.fpmLabel(recorder.snapshot.climbRate))
        }
    }

    private struct Readout: View {
        var title: String
        var value: String
        var emphasis: Bool = false

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(emphasis ? Color.orange : Color.primary)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: - Terrain

    private var terrainCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label("Terén pod letadlem", systemImage: "mountain.2")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text(recorder.elevation?.source.label ?? "neznámá")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(sourceColor.opacity(0.18), in: Capsule())
                    .foregroundStyle(sourceColor)
            }
            Text(recorder.elevation.map { "\(Int($0.meters.rounded())) m n. m. (\(Units.feetLabel($0.meters)))" }
                 ?? "Bez údaje o terénu — detekce jede jen podle rychlosti a stoupání.")
                .font(.callout)
                .foregroundStyle(.secondary)
            if let airport = recorder.nearestAirport {
                Text("Nejbližší letiště: \(airport.code) — \(airport.name)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    private var sourceColor: Color {
        switch recorder.elevation?.source ?? .unavailable {
        case .groundReference, .airport: return .green
        case .online, .cache: return .blue
        case .unavailable: return .red
        }
    }

    // MARK: - Cards

    private func currentFlightCard(_ flight: Flight) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Probíhá let", systemImage: "airplane.departure")
                .font(.subheadline.weight(.semibold))
            Text("Vzlet \(flight.takeoff.time.formatted(date: .omitted, time: .standard)) — \(flight.departureLabel)")
                .font(.callout)
            // Ticks once a second so the airborne time is live, not frozen at
            // whatever moment SwiftUI last redrew the view.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text("Ve vzduchu \(Units.durationLabel(context.date.timeIntervalSince(flight.takeoff.time))) · \(Units.distanceLabel(flight.distance))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
    }

    private func lastEventCard(_ event: FlightEvent) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Poslední událost")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text("\(event.kind.label) · \(event.time.formatted(date: .abbreviated, time: .standard))")
                .font(.callout.weight(.semibold))
            Text("\(event.airport ?? Units.coordinateLabel(event.coordinate)) · \(Units.knotsLabel(event.speed)) · AGL \(Units.feetLabel(event.agl)) · \(event.confidence.label)")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(spacing: 12) {
            Button {
                recorder.isRecording ? recorder.stop() : recorder.start()
            } label: {
                Label(
                    recorder.isRecording ? "Zastavit záznam" : "Spustit záznam",
                    systemImage: recorder.isRecording ? "stop.circle" : "record.circle"
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(recorder.isRecording ? .red : .orange)

            if location.authorization == .authorizedWhenInUse {
                Text("Povolení je jen „Při používání“ — se zhasnutým displejem se nezaznamenává. V Nastavení iOS přepni na „Vždy“.")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
            }
            if location.authorization == .denied || location.authorization == .restricted {
                Text("Poloha je zakázaná. Bez ní aplikace nic nezaznamená — povol ji v Nastavení iOS.")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }

            HStack(spacing: 12) {
                Button("Ručně: vzlet") { recorder.logManualEvent(.takeoff) }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
                Button("Ručně: přistání") { recorder.logManualEvent(.landing) }
                    .buttonStyle(.bordered)
                    .frame(maxWidth: .infinity)
            }
            .disabled(location.lastFix == nil)
        }
    }
}
