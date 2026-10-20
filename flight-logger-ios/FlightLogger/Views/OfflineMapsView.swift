import SwiftUI

/// Downloading and managing the map that works without a signal.
struct OfflineMapsView: View {

    @EnvironmentObject private var settings: AppSettings
    @EnvironmentObject private var recorder: FlightRecorder
    @EnvironmentObject private var location: LocationService
    @ObservedObject var store: TileStore
    @ObservedObject var downloader: TileDownloader

    @State private var editingSource = false
    @State private var adding: PendingRegion?

    var body: some View {
        List {
            sourceSection
            if downloader.progress != nil { progressSection }
            addSection
            regionSection
            storageSection
        }
        .navigationTitle("Offline mapa")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editingSource) {
            TileSourceEditor(source: settings.tileSource) { settings.tileSource = $0 }
        }
        .sheet(item: $adding) { pending in
            RegionEditor(pending: pending) { region in
                downloader.start(region: region, source: settings.tileSource ?? .customTemplate, store: store)
            }
        }
    }

    // MARK: - Source

    private var sourceSection: some View {
        Section {
            Button {
                editingSource = true
            } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(settings.tileSource?.name ?? "Apple Maps")
                            .foregroundStyle(.primary)
                        Text(sourceDetail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            Toggle("Dotahovat dlaždice při prohlížení", isOn: $settings.downloadTilesWhileBrowsing)
        } header: {
            Text("Zdroj mapy")
        } footer: {
            Text("Veřejné servery OpenStreetMap mapu po oblastech stahovat nedovolují — jejich "
               + "dlaždice jsou dar, ne služba. Na offline mapu nastav vlastní zdroj, který to má "
               + "v podmínkách (MapTiler, Thunderforest, Stadia a podobné mají free tarif, který "
               + "offline cache povoluje), nebo si pusť vlastní server.")
        }
    }

    private var sourceDetail: String {
        guard let source = settings.tileSource else {
            return "Bez signálu zůstane mapa prázdná. Trasa se kreslí dál."
        }
        guard source.isUsable else { return "Adresa není vyplněná" }
        return source.allowsBulkDownload
            ? "Zoom \(source.minZoom)–\(source.maxZoom) · \(Int(source.requestsPerSecond)) dotazů/s"
            : "Jen prohlížení — stahovat oblasti nedovoluje"
    }

    // MARK: - Progress

    private var progressSection: some View {
        Section("Stahuje se") {
            if let progress = downloader.progress {
                VStack(alignment: .leading, spacing: 7) {
                    Text(progress.regionName).font(.subheadline.weight(.semibold))
                    ProgressView(value: progress.fraction)
                    HStack {
                        Text("\(progress.done + progress.skipped) z \(progress.total)")
                        if progress.skipped > 0 {
                            Text("· \(progress.skipped) už bylo")
                        }
                        if progress.failed > 0 {
                            Text("· \(progress.failed) selhalo").foregroundStyle(.orange)
                        }
                        Spacer()
                        Text(Units.bytesLabel(progress.bytes))
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
                Button("Zastavit", role: .destructive) { downloader.cancel() }
            }
        }
    }

    // MARK: - Adding

    private var addSection: some View {
        Section {
            Button {
                adding = pending(named: "Tady", at: location.lastFix?.coordinate)
            } label: {
                Label("Stáhnout okolí aktuální polohy", systemImage: "location.circle")
            }
            .disabled(location.lastFix == nil || downloader.isRunning)

            ForEach(nearbyAirfields, id: \.id) { airfield in
                Button {
                    adding = pending(named: airfield.code, at: airfield.coordinate)
                } label: {
                    Label("Stáhnout okolí \(airfield.code)", systemImage: "airplane.circle")
                }
                .disabled(downloader.isRunning)
            }
        } header: {
            Text("Přidat oblast")
        } footer: {
            if let error = downloader.lastError {
                Text(error).foregroundStyle(.orange)
            }
        }
    }

    /// The fields the pilot actually uses — their own, newest first. No point
    /// offering to download the whole dataset.
    private var nearbyAirfields: [Airport] {
        Array(recorder.airports.learned.prefix(5))
    }

    private func pending(named name: String, at coordinate: Coordinate?) -> PendingRegion? {
        guard let coordinate else { return nil }
        return PendingRegion(name: name, center: coordinate)
    }

    // MARK: - Regions

    @ViewBuilder
    private var regionSection: some View {
        if store.regions.isEmpty {
            Section("Stažené oblasti") {
                Text("Zatím nic. Bez stažené oblasti je mapa ve vzduchu prázdná — trasa se na ni "
                   + "kreslí dál, protože jde ze zapisovače, ne z mapy.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        } else {
            Section("Stažené oblasti") {
                ForEach(store.regions) { region in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(region.name).font(.body.weight(.medium))
                            Spacer()
                            if region.isComplete {
                                Text(Units.bytesLabel(region.bytes))
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                            } else {
                                Text("\(Int(region.progress * 100)) %")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.orange)
                            }
                        }
                        Text("\(Int(region.radius / 1000)) km · zoom \(region.minZoom)–\(region.maxZoom) "
                           + "· \(region.storedTiles) z \(region.expectedTiles) dlaždic")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 1)
                }
                .onDelete { offsets in
                    let doomed = offsets.map { store.regions[$0] }
                    for region in doomed { store.delete(region) }
                }
            }
        }
    }

    // MARK: - Storage

    private var storageSection: some View {
        Section {
            HStack {
                Text("Na disku")
                Spacer()
                Text(Units.bytesLabel(store.bytesOnDisk))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Button("Smazat všechny dlaždice", role: .destructive) {
                store.deleteAllTiles()
            }
            .disabled(store.bytesOnDisk == 0)
        } header: {
            Text("Úložiště")
        } footer: {
            Text("Dlaždice leží v `tiles/z/x/y.png` — stejně jako je má každý XYZ server, takže "
               + "se dají i nasypat z venku.")
        }
    }
}

/// A region being set up, before it is worth saving anything.
fileprivate struct PendingRegion: Identifiable {
    var id = UUID()
    var name: String
    var center: Coordinate
    var radiusKm: Double = 30
    var minZoom: Int = 10
    var maxZoom: Int = 13
}

// MARK: - Source editor

private struct TileSourceEditor: View {

    var source: TileSource?
    var onSave: (TileSource?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var useApple: Bool
    @State private var name: String
    @State private var template: String
    @State private var attribution: String
    @State private var key: String
    @State private var minZoom: Int
    @State private var maxZoom: Int
    @State private var rate: Double

    init(source: TileSource?, onSave: @escaping (TileSource?) -> Void) {
        self.source = source
        self.onSave = onSave
        let base = source ?? .customTemplate
        _useApple = State(initialValue: source == nil)
        _name = State(initialValue: base.name)
        _template = State(initialValue: base.urlTemplate)
        _attribution = State(initialValue: base.attribution)
        _key = State(initialValue: base.apiKey ?? "")
        _minZoom = State(initialValue: base.minZoom)
        _maxZoom = State(initialValue: base.maxZoom)
        _rate = State(initialValue: base.requestsPerSecond)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("Apple Maps", isOn: $useApple)
                } footer: {
                    Text("Apple Maps vypadá nejlíp a ve vzduchu nefunguje — jejich dlaždice se "
                       + "uložit nedají. Offline mapa potřebuje vlastní zdroj.")
                }

                if !useApple {
                    Section("Zdroj") {
                        TextField("Název", text: $name)
                        TextField("https://…/{z}/{x}/{y}.png", text: $template, axis: .vertical)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .lineLimit(2...4)
                        TextField("Klíč (doplní se za {key})", text: $key)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Uvedení zdroje, např. © OpenStreetMap contributors",
                                  text: $attribution, axis: .vertical)
                            .lineLimit(1...3)
                    }

                    Section("Rozsah") {
                        Stepper("Nejmenší zoom: \(minZoom)", value: $minZoom, in: 1...18)
                        Stepper("Největší zoom: \(maxZoom)", value: $maxZoom, in: 1...18)
                        Stepper("Dotazů za sekundu: \(Int(rate))", value: $rate, in: 1...16, step: 1)
                    }

                    Section {
                        Button {
                            template = TileSource.openStreetMap.urlTemplate
                            attribution = TileSource.openStreetMap.attribution
                            name = TileSource.openStreetMap.name
                            rate = TileSource.openStreetMap.requestsPerSecond
                        } label: {
                            Text("Předvyplnit OpenStreetMap (jen prohlížení)")
                        }
                    } footer: {
                        Text("Veřejné dlaždice OSM se smí prohlížet, ne stahovat po oblastech. "
                           + "Aplikace to hlídá a stažení oblasti z nich odmítne.")
                    }
                }
            }
            .navigationTitle("Zdroj mapy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zavřít") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Uložit") {
                        guard !useApple else { onSave(nil); dismiss(); return }
                        let isOSM = template == TileSource.openStreetMap.urlTemplate
                        onSave(TileSource(
                            id: isOSM ? "osm" : "custom",
                            name: name.isEmpty ? "Vlastní zdroj" : name,
                            urlTemplate: template.trimmingCharacters(in: .whitespacesAndNewlines),
                            attribution: attribution,
                            minZoom: min(minZoom, maxZoom),
                            maxZoom: max(minZoom, maxZoom),
                            requestsPerSecond: rate,
                            allowsBulkDownload: !isOSM,
                            apiKey: key.isEmpty ? nil : key
                        ))
                        dismiss()
                    }
                }
            }
        }
    }
}

// MARK: - Region editor

private struct RegionEditor: View {

    var pending: PendingRegion
    var onStart: (OfflineRegion) -> Void

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var settings: AppSettings
    @State private var name: String
    @State private var radiusKm: Double
    @State private var minZoom: Int
    @State private var maxZoom: Int

    init(pending: PendingRegion, onStart: @escaping (OfflineRegion) -> Void) {
        self.pending = pending
        self.onStart = onStart
        _name = State(initialValue: pending.name)
        _radiusKm = State(initialValue: pending.radiusKm)
        _minZoom = State(initialValue: pending.minZoom)
        _maxZoom = State(initialValue: pending.maxZoom)
    }

    private var region: OfflineRegion {
        OfflineRegion(
            name: name.isEmpty ? pending.name : name,
            center: pending.center,
            radius: radiusKm * 1000,
            minZoom: min(minZoom, maxZoom),
            maxZoom: max(minZoom, maxZoom),
            sourceID: settings.tileSource?.id ?? "custom"
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Oblast") {
                    TextField("Název", text: $name)
                    VStack(alignment: .leading) {
                        Text("Okruh: \(Int(radiusKm)) km")
                        Slider(value: $radiusKm, in: 5...80, step: 5)
                    }
                    Stepper("Nejmenší zoom: \(minZoom)", value: $minZoom, in: 6...16)
                    Stepper("Největší zoom: \(maxZoom)", value: $maxZoom, in: 6...16)
                }

                Section {
                    LabeledContent("Dlaždic", value: "\(region.expectedTiles)")
                    LabeledContent("Odhad velikosti", value: Units.bytesLabel(region.estimatedBytes))
                    LabeledContent(
                        "Nejjemnější detail",
                        value: String(
                            format: "%.0f m/px",
                            TileMath.groundResolution(latitude: pending.center.latitude, zoom: max(minZoom, maxZoom))
                        )
                    )
                } footer: {
                    if let failure = TileDownloader.validate(
                        region: region,
                        source: settings.tileSource ?? .customTemplate
                    ) {
                        Text(failure.errorDescription ?? "").foregroundStyle(.orange)
                    } else {
                        Text("Odhad počítá s 18 kB na dlaždici. Skutečná velikost se doplní, "
                           + "jakmile se něco stáhne.")
                    }
                }
            }
            .navigationTitle("Stáhnout oblast")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zavřít") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Stáhnout") {
                        onStart(region)
                        dismiss()
                    }
                    .disabled(TileDownloader.validate(
                        region: region,
                        source: settings.tileSource ?? .customTemplate
                    ) != nil)
                }
            }
        }
    }
}
