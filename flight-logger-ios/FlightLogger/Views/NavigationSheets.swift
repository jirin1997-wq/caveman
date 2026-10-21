import SwiftUI

/// EMER — the fields nearest the aircraft, nearest first. Picking one makes it
/// the Direct-to target.
struct EmergencySheet: View {

    @EnvironmentObject private var recorder: FlightRecorder
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    let items = recorder.nearbyAirfields(limit: 8)
                    if items.isEmpty {
                        Text(L10n.t("Žádná plocha v dosahu 60 km."))
                            .foregroundStyle(.secondary)
                    }
                    ForEach(items) { item in
                        Button {
                            recorder.setDirectTarget(item.airport)
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.airport.code).font(.headline)
                                    Text(item.airport.name)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(String(format: "%.1f NM", item.distance / 1852))
                                        .font(.subheadline.monospacedDigit().weight(.semibold))
                                    Text(String(format: "%03.0f°", item.bearing))
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text(L10n.t("Nejbližší plochy"))
                } footer: {
                    Text(L10n.t("Frekvence a délky drah v datech nejsou. Ověř je před přistáním na mapě letiště."))
                }
            }
            .navigationTitle("EMER")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("Zavřít")) { dismiss() }
                }
            }
        }
    }
}

/// DIRECT — choose the field to fly to. Searchable, nearest first.
struct DirectSheet: View {

    @EnvironmentObject private var recorder: FlightRecorder
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var items: [AirfieldBearing] {
        let all = recorder.nearbyAirfields(limit: 200)
        guard !query.isEmpty else { return all }
        return all.filter {
            $0.airport.code.localizedCaseInsensitiveContains(query)
                || $0.airport.name.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if recorder.directTarget != nil {
                    Section {
                        Button(role: .destructive) {
                            recorder.setDirectTarget(nil)
                            dismiss()
                        } label: {
                            Label(L10n.t("Zrušit cíl"), systemImage: "xmark.circle")
                        }
                    }
                }
                Section {
                    ForEach(items) { item in
                        Button {
                            recorder.setDirectTarget(item.airport)
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.airport.code).font(.headline)
                                    Text(item.airport.name)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(String(format: "%.1f NM", item.distance / 1852))
                                        .font(.subheadline.monospacedDigit())
                                    Text(String(format: "%03.0f°", item.bearing))
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text(L10n.t("Vyber letiště, ke kterému letíš"))
                }
            }
            .searchable(text: $query, prompt: L10n.t("Hledat letiště"))
            .navigationTitle("DIRECT")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("Zavřít")) { dismiss() }
                }
            }
        }
    }
}

/// MENU — the things that are not one tap on the main screen.
struct MenuSheet: View {

    @EnvironmentObject private var recorder: FlightRecorder
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button(L10n.t("Ručně: vzlet")) {
                        recorder.logManualEvent(.takeoff)
                        dismiss()
                    }
                    Button(L10n.t("Ručně: přistání")) {
                        recorder.logManualEvent(.landing)
                        dismiss()
                    }
                } header: {
                    Text(L10n.t("Ruční zápis"))
                } footer: {
                    Text(L10n.t("Ručně zapíše vzlet nebo přistání, když detekce něco vynechá."))
                }
            }
            .navigationTitle("MENU")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("Zavřít")) { dismiss() }
                }
            }
        }
    }
}
