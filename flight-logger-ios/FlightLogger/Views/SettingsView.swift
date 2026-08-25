import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var recorder: FlightRecorder
    @EnvironmentObject private var store: FlightStore

    @State private var showingAirportImporter = false
    @State private var importMessage: String?
    @State private var showingResetConfirm = false

    var body: some View {
        NavigationStack {
            Form {
                aircraftSection
                profileSection
                thresholdSection
                terrainSection
                simulationSection
                dataSection
                aboutSection
            }
            .navigationTitle("Nastavení")
            .onChange(of: settings.profile) { recorder.applySettings() }
            .onChange(of: settings.useOnlineElevation) { recorder.applySettings() }
            .onChange(of: settings.keepScreenAwake) { recorder.applySettings() }
            .fileImporter(
                isPresented: $showingAirportImporter,
                allowedContentTypes: [.json],
                allowsMultipleSelection: false
            ) { result in
                importAirports(result)
            }
            .alert("Import letišť", isPresented: Binding(
                get: { importMessage != nil },
                set: { if !$0 { importMessage = nil } }
            )) {
                Button("OK", role: .cancel) { importMessage = nil }
            } message: {
                Text(importMessage ?? "")
            }
        }
    }

    // MARK: - Sections

    private var aircraftSection: some View {
        Section("Letadlo") {
            TextField("Imatrikulace (např. OK-ABC)", text: $settings.aircraft)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
        }
    }

    private var profileSection: some View {
        Section {
            Picker("Typ", selection: Binding(
                get: { settings.profile.name },
                set: { name in
                    if let preset = DetectionProfile.presets.first(where: { $0.name == name }) {
                        settings.profile = preset
                    }
                }
            )) {
                ForEach(DetectionProfile.presets, id: \.name) { preset in
                    Text(preset.name).tag(preset.name)
                }
                if !DetectionProfile.presets.contains(where: { $0 == settings.profile }) {
                    Text("Vlastní").tag(settings.profile.name)
                }
            }
        } header: {
            Text("Profil detekce")
        } footer: {
            Text("Kluzák se odlepí kolem 30 kt, turbovrtulový stroj kolem 90. Podle typu se nastaví prahy rychlosti a výšky.")
        }
    }

    private var thresholdSection: some View {
        Section {
            slider(
                "Rychlost pro vzlet",
                value: Binding(
                    get: { Units.mpsToKnots(settings.profile.takeoffSpeed) },
                    set: { settings.profile.takeoffSpeed = Units.knotsToMps($0) }
                ),
                range: 15...120,
                unit: "kt"
            )
            slider(
                "Rychlost pro přistání",
                value: Binding(
                    get: { Units.mpsToKnots(settings.profile.landingSpeed) },
                    set: { settings.profile.landingSpeed = Units.knotsToMps($0) }
                ),
                range: 10...100,
                unit: "kt"
            )
            slider(
                "Výška = letím",
                value: Binding(
                    get: { Units.metersToFeet(settings.profile.airborneAGL) },
                    set: { settings.profile.airborneAGL = Units.feetToMeters($0) }
                ),
                range: 30...500,
                unit: "ft AGL"
            )
            slider(
                "Výška = na zemi",
                value: Binding(
                    get: { Units.metersToFeet(settings.profile.groundAGL) },
                    set: { settings.profile.groundAGL = Units.feetToMeters($0) }
                ),
                range: 15...250,
                unit: "ft AGL"
            )
            slider(
                "Potvrzení změny",
                value: Binding(
                    get: { settings.profile.confirmDuration },
                    set: { settings.profile.confirmDuration = $0 }
                ),
                range: 2...20,
                unit: "s"
            )
        } header: {
            Text("Prahy")
        } footer: {
            Text("Vzlet i přistání musí platit současně obě podmínky — rychlost i výška nad terénem — a musí vydržet po celou dobu potvrzení. Rychlost pro přistání drž níž než pro vzlet, ten rozdíl brání překlápění tam a zpět.")
        }
    }

    private var terrainSection: some View {
        Section {
            Toggle("Online doplňování terénu", isOn: $settings.useOnlineElevation)
            if let reference = recorder.groundReference {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Reference ze země: \(Int(reference.meters.rounded())) m n. m.")
                    Text("\(reference.sampleCount) vzorků · \(reference.time.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("Reference ze země zatím není — vznikne, až letadlo chvíli postojí se zapnutým záznamem.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Uložených dlaždic terénu")
                Spacer()
                Text("\(recorder.cachedTiles)").foregroundStyle(.secondary)
            }
            NavigationLink {
                AirfieldsView(database: recorder.airports)
            } label: {
                HStack {
                    Text("Plochy a letiště")
                    Spacer()
                    Text("\(recorder.airportCount)").foregroundStyle(.secondary)
                }
            }
            Toggle("Zakládat plochy automaticky", isOn: $settings.learnAirfields)
            Button("Importovat databázi letišť (JSON)") { showingAirportImporter = true }
        } header: {
            Text("Terén")
        } footer: {
            Text("Pořadí zdrojů: reference naměřená na zemi → databáze ploch → cache → online. Ve vzduchu obvykle není signál, takže online je jen bonus, nikdy základ. Plochu, která v databázi není (LKHN, Záhoří, jezero, soukromá louka), si aplikace zapamatuje sama při prvním letu — stačí ji pak přejmenovat. Když zakládání vypneš, neznámá místa zůstanou v deníku jako souřadnice.")
        }
    }

    private var simulationSection: some View {
        Section {
            Button("Simulovat standardní let") {
                recorder.startSimulation(SyntheticTrack.standardFlight())
            }
            Button("Simulovat touch & go") {
                recorder.startSimulation(SyntheticTrack.touchAndGo())
            }
            Button("Simulovat rychlé pojíždění (nesmí nic zapsat)") {
                recorder.startSimulation(SyntheticTrack.fastTaxiNoTakeoff())
            }
            if recorder.isSimulating {
                Button("Zastavit simulaci", role: .destructive) { recorder.stopSimulation() }
            }
        } header: {
            Text("Simulace")
        } footer: {
            Text("Přehraje umělou trasu skrz stejnou detekci jako za letu, 20× zrychleně. Jediný způsob, jak si aplikaci vyzkoušet, aniž bys vzlétl.")
        }
    }

    private var dataSection: some View {
        Section("Data") {
            Toggle("Nechat displej svítit při záznamu", isOn: $settings.keepScreenAwake)
            Button("Smazat referenci ze země") {
                recorder.elevationProvider.clearGroundReference()
                settings.groundReference = nil
            }
            Button("Smazat celý deník", role: .destructive) { showingResetConfirm = true }
                .confirmationDialog(
                    "Opravdu smazat všechny lety i trasy? Nejde vzít zpět.",
                    isPresented: $showingResetConfirm,
                    titleVisibility: .visible
                ) {
                    Button("Smazat vše", role: .destructive) { store.deleteAll() }
                    Button("Zrušit", role: .cancel) {}
                }
        }
    }

    private var aboutSection: some View {
        Section {
            NavigationLink("Jak detekce funguje") { DetectionExplainerView() }
        } footer: {
            Text("Záznam na pozadí vyžaduje povolení polohy „Vždy“. S „Při používání“ se zaznamenává jen když je aplikace na obrazovce.")
        }
    }

    // MARK: - Helpers

    private func slider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, unit: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                Spacer()
                Text("\(Int(value.wrappedValue.rounded())) \(unit)")
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Slider(value: value, in: range)
        }
    }

    private func importAirports(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            importMessage = "Import selhal: \(error.localizedDescription)"
        case .success(let urls):
            guard let source = urls.first else { return }
            let scoped = source.startAccessingSecurityScopedResource()
            defer { if scoped { source.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: source)
                let list = try JSONDecoder().decode([Airport].self, from: data)
                let destination = AppPaths.root.appendingPathComponent(AirportDatabase.userDatabaseFilename)
                try data.write(to: destination, options: .atomic)
                recorder.reloadAirports()
                importMessage = "Načteno \(list.count) letišť."
            } catch {
                importMessage = "Soubor se nepodařilo přečíst: \(error.localizedDescription)"
            }
        }
    }
}

/// Plain-language explanation of the detection rule, in the app itself.
struct DetectionExplainerView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Dvě podmínky najednou")
                    .font(.title3.weight(.bold))
                Text("Vzlet se zapíše, až GPS ukáže rychlost nad prahem typu letadla **a zároveň** výšku nad terénem toho místa. Samotná nadmořská výška nestačí — letiště v 600 m je „vysoko“ pořád. Samotná rychlost taky ne — rychlé pojíždění nebo jízda autem po dálnici vypadá jako odlet.")
                Text("Přistání je totéž obráceně: nízko nad terénem a pomalu, obojí zároveň.")

                Text("Odkud se bere výška terénu")
                    .font(.title3.weight(.bold))
                Text("1. Reference ze země — medián výšky, kterou GPS naměřila, když letadlo stálo. Stejný přijímač, stejná chyba, stejné místo: pro domovské letiště nejlepší zdroj, jaký existuje.\n2. Databáze letišť — publikovaná nadmořská výška plochy, offline.\n3. Cache — dřív stažené dlaždice terénu.\n4. Online — dotaz na Open-Meteo, když je signál. Zapíše se do cache pro příště.")

                Text("Proč to nezapíše každý poryv")
                    .font(.title3.weight(.bold))
                Text("Prahy pro vzlet a přistání jsou různé (hystereze) a každá podmínka musí vydržet několik sekund. Událost se pak zapíše zpětně na okamžik, kdy se kola opravdu odlepila — ne na okamžik, kdy si tím aplikace byla jistá.")

                Text("Když terén není známý")
                    .font(.title3.weight(.bold))
                Text("Detekce jede dál jen podle rychlosti a stoupání a událost se označí jako nejistá. Radši nejistý zápis než žádný.")
            }
            .padding()
        }
        .navigationTitle("Jak detekce funguje")
        .navigationBarTitleDisplayMode(.inline)
    }
}
