import SwiftUI

/// The airfields the app knows about.
///
/// The bundled dataset covers a couple of dozen fields; everything else the app
/// learns by watching where flights start and end. This is where a placeholder
/// like "Plocha 1" becomes "LKHN" — once, permanently, and retroactively in the
/// logbook.
struct AirfieldsView: View {

    @EnvironmentObject private var recorder: FlightRecorder
    @EnvironmentObject private var location: LocationService
    @ObservedObject var database: AirportDatabase

    @State private var editing: Airport?
    @State private var showingAdd = false

    var body: some View {
        List {
            Section {
                if database.learned.isEmpty {
                    Text("Zatím žádné vlastní plochy. Vznikne sama, jakmile vzlétneš nebo přistaneš někde, co není v databázi — pak ji tady přejmenuješ. Vodní plochu označ jako vodu, počítá se pak s tím, že se vzlétá na jednom konci jezera a přistává na druhém.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(database.learned) { airfield in
                        Button {
                            editing = airfield
                        } label: {
                            row(airfield)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { offsets in
                        // Collect the ids first — removing by index while the
                        // offsets are still being walked deletes the wrong rows.
                        let ids = offsets.map { database.learned[$0].id }
                        for id in ids { database.forget(id: id) }
                    }
                }
                Button {
                    showingAdd = true
                } label: {
                    Label("Přidat aktuální polohu", systemImage: "mappin.and.ellipse")
                }
                .disabled(location.lastFix == nil)
            } header: {
                Text("Moje plochy")
            } footer: {
                Text("Nadmořská výška se doplní sama, až tady letadlo chvíli postojí se zapnutým záznamem. Od té chvíle zná aplikace výšku nad zemí hned po startu, i bez signálu.")
            }

            Section("Z databáze (\(database.airports.count))") {
                if database.airports.isEmpty {
                    Text("Prázdná.").foregroundStyle(.secondary)
                } else {
                    ForEach(database.airports.prefix(50)) { airport in
                        row(airport)
                    }
                    if database.airports.count > 50 {
                        Text("…a dalších \(database.airports.count - 50)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Plochy")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editing) { airfield in
            AirfieldEditor(airfield: airfield) { code, name, kind in
                recorder.renameAirfield(id: airfield.id, code: code, name: name, kind: kind)
                editing = nil
            }
        }
        .sheet(isPresented: $showingAdd) {
            AirfieldEditor(airfield: nil) { code, name, kind in
                recorder.addCurrentPositionAsAirfield(code: code, name: name, kind: kind)
                showingAdd = false
            }
        }
    }

    private func row(_ airfield: Airport) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(airfield.code).font(.headline)
                if airfield.isLearned {
                    Tag(text: "vlastní", color: .orange)
                }
                if airfield.surface == .water {
                    Tag(text: "voda", color: .blue)
                }
                Spacer()
                Text(airfield.elevation.map { "\(Int($0.rounded())) m" } ?? "výška neznámá")
                    .font(.caption)
                    .foregroundStyle(airfield.elevation == nil ? .secondary : .primary)
            }
            Text(airfield.name)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

private struct AirfieldEditor: View {

    var airfield: Airport?
    var onSave: (String, String, AirfieldKind) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var code: String = ""
    @State private var name: String = ""
    @State private var kind: AirfieldKind = .land

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Kód (např. LKHN)", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    TextField("Název (např. Hodkovice)", text: $name)
                    Picker("Povrch", selection: $kind) {
                        ForEach(AirfieldKind.allCases, id: \.self) { option in
                            Text(option.label).tag(option)
                        }
                    }
                } footer: {
                    Text(airfield?.isLearned == false
                         ? "Plochy z databáze se upravovat nedají."
                         : "Kód se použije v deníku. Přejmenování opraví i lety, které už jsou zapsané. Vodní plocha se párují na 6 km místo 2 km — jezero je větší než dráha.")
                }
            }
            .navigationTitle(airfield == nil ? "Nová plocha" : "Upravit plochu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zrušit") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Uložit") {
                        onSave(
                            code.trimmingCharacters(in: .whitespaces),
                            name.trimmingCharacters(in: .whitespaces),
                            kind
                        )
                        dismiss()
                    }
                    .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || airfield?.isLearned == false)
                }
            }
            .onAppear {
                code = airfield?.code ?? ""
                name = airfield?.name ?? ""
                kind = airfield?.surface ?? .land
            }
        }
    }
}
