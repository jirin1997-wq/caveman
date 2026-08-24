import SwiftUI

struct LogbookView: View {

    @EnvironmentObject private var store: FlightStore
    @EnvironmentObject private var recorder: FlightRecorder
    @State private var shareURL: URL?

    var body: some View {
        NavigationStack {
            Group {
                if store.flights.isEmpty {
                    ContentUnavailableView(
                        "Zatím žádné lety",
                        systemImage: "airplane.circle",
                        description: Text("Spusť záznam na kartě Let. Vzlet a přistání se zapíšou samy.")
                    )
                } else {
                    List {
                        Section {
                            summaryRow
                        }
                        ForEach(store.flights) { flight in
                            NavigationLink(value: flight.id) {
                                FlightRow(flight: flight, isCurrent: flight.id == recorder.currentFlight?.id)
                            }
                        }
                        .onDelete(perform: delete)
                    }
                    .navigationDestination(for: UUID.self) { id in
                        if let flight = store.flights.first(where: { $0.id == id }) {
                            FlightDetailView(flight: flight)
                        }
                    }
                }
            }
            .navigationTitle("Deník")
            .toolbar {
                if !store.flights.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            shareURL = store.exportLogbookCSV()
                        } label: {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                }
            }
            .sheet(item: Binding(
                get: { shareURL.map(ShareItem.init) },
                set: { shareURL = $0?.url }
            )) { item in
                ShareSheet(url: item.url)
            }
        }
    }

    private var summaryRow: some View {
        let closed = store.flights.filter { !$0.isOpen }
        let hours = closed.compactMap(\.duration).reduce(0, +)
        let landings = closed.count
        return HStack {
            VStack(alignment: .leading) {
                Text("Nalétáno").font(.caption).foregroundStyle(.secondary)
                Text(Units.durationLabel(hours)).font(.title3.weight(.bold))
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text("Přistání").font(.caption).foregroundStyle(.secondary)
                Text("\(landings)").font(.title3.weight(.bold))
            }
        }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets {
            store.delete(store.flights[index])
        }
    }
}

private struct FlightRow: View {
    var flight: Flight
    var isCurrent: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(flight.departureLabel) → \(flight.arrivalLabel)")
                    .font(.headline)
                Spacer()
                Text(Units.durationLabel(flight.duration))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 6) {
                Text(flight.takeoff.time.formatted(date: .abbreviated, time: .shortened))
                if flight.isTouchAndGo {
                    Tag(text: "touch & go", color: .purple)
                }
                if isCurrent {
                    Tag(text: "probíhá", color: .green)
                } else if flight.isOpen {
                    Tag(text: "nedokončeno", color: .orange)
                }
                if flight.takeoff.confidence != .high {
                    Tag(text: flight.takeoff.confidence.label, color: .gray)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

struct Tag: View {
    var text: String
    var color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
}

struct ShareItem: Identifiable {
    var url: URL
    var id: String { url.absoluteString }
}
