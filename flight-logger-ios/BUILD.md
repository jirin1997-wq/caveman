# Jak to dostat do telefonu

Tenhle soubor je návod na první `⌘B`. Aplikace se **nikdy nezkompilovala** —
vznikla v prostředí bez Swift toolchainu — takže první build je zároveň první
skutečný test. Níž je jednak postup, jednak seznam chyb, které se u prvního
buildu reálně objevují, a co na ně.

---

## Co potřebuješ

| | Verze | Proč |
|---|---|---|
| **Mac** | macOS, na kterém běží Xcode 16 | Nativní iOS aplikace se jinak na iPhone nedostane |
| **Xcode** | **16 nebo novější** | Projekt má `objectVersion = 77` a používá synchronizované skupiny. Starší Xcode ho neotevře — viz [Starší Xcode](#starší-xcode) |
| **iPhone** | iOS 17.0+ | `IPHONEOS_DEPLOYMENT_TARGET = 17.0` |
| **Apple ID** | stačí zdarma | Free účet umí podepsat aplikaci na vlastní zařízení. Platí **7 dní**, pak se přeinstaluje |

Barometr má iPhone 6 a novější. Bez něj aplikace funguje, jen počítá výšku nad
zemí hruběji — viz sekce Barometr v `README.md`.

---

## Postup

### 1. Stáhni projekt

```bash
git clone -b claude/flight-tracking-app-uci2n0 https://github.com/jirin1997-wq/caveman
cd caveman/flight-logger-ios
open FlightLogger.xcodeproj
```

### 2. Nastav podpis

V Xcode vlevo klikni na modrou ikonu **FlightLogger** → target **FlightLogger**
→ záložka **Signing & Capabilities**:

1. **Team** → vyber svoje Apple ID. Když tam žádné není: *Xcode → Settings →
   Accounts → +* a přihlas se.
2. **Bundle Identifier** → přepiš `cz.letovyzapisovac.FlightLogger` na něco
   svého, třeba `cz.tvojejmeno.FlightLogger`. To identifikátor musí být na světě
   unikátní; ten výchozí ti Apple nepodepíše.
3. **Automatically manage signing** nech zaškrtnuté.

Totéž zopakuj pro target **FlightLoggerTests** (stačí Team; bundle ID si Xcode
odvodí).

> **Capabilities nic přidávat nemusíš.** Background location je v `Info.plist`
> (`UIBackgroundModes = location`) a žádný entitlement navíc nechce — proto to
> jde i na free účtu.

### 3. Spusť

Připoj iPhone kabelem, nahoře v liště vyber jako cíl svoje zařízení (ne
simulátor) a zmáčkni **⌘R**.

Na telefonu pak jednou: *Nastavení → Obecné → VPN a správa zařízení → tvoje
Apple ID → Důvěřovat*. Bez toho se aplikace nespustí.

### 4. Vyzkoušej to na zemi

V aplikaci: **Nastavení → Simulace → Simulovat standardní let**. Přehraje
umělou trasu skrz úplně stejnou detekci jako za letu, 20× zrychleně. Do minuty
uvidíš, jestli naskočí vyjetí, vzlet, přistání i zastavení, a jak se kreslí
mapa a graf.

Jsou tři: standardní let, touch & go, a **rychlé pojíždění, které nesmí zapsat
nic** — ten třetí je nejužitečnější, protože prověřuje, že detekce nevyrábí
falešné vzlety.

### 5. Povolení, než poletíš

- **Poloha → Vždy.** Při prvním spuštění iOS nabídne jen „Při používání“;
  aplikace si o „Vždy“ řekne podruhé. Bez toho se se zhasnutým displejem
  nezaznamenává a na hlavní obrazovce svítí varování.
- **Pohyb a fitness → povolit.** To je barometr a akcelerometr.

---

## Testy

Projekt má sdílené schéma, takže testy jdou z Xcode i z terminálu.

```bash
# v Xcode
⌘U

# z terminálu, na simulátoru
xcodebuild test \
  -project FlightLogger.xcodeproj \
  -scheme FlightLogger \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

Pokud ten simulátor nemáš, `xcrun simctl list devices available` ukáže, co je
po ruce, a jméno dosaď.

Testy nepotřebují GPS ani senzory — detekce se krmí umělými trasami a úložiště
se přesměruje do dočasné složky (`AppPaths.useDirectory`), takže ti nesahají na
skutečný deník.

Co je pokryté, je vypsané v README v sekci „Co je ověřené“. Nejdůležitější je
`tools/detector-reference.py` — Python přepis detektoru, který jede stejných
11 scénářů a je jediná věc, která se v tomhle prostředí dala doopravdy spustit.

```bash
python3 tools/detector-reference.py
```

---

## Když první build spadne

### „The project is in an unsupported format“ / projekt nejde otevřít {#starší-xcode}

Máš Xcode starší než 16. Buď ho aktualizuj, nebo si projekt vygeneruj znovu:

```bash
brew install xcodegen
cd flight-logger-ios
xcodegen generate
open FlightLogger.xcodeproj
```

`project.yml` je na to přibalený a dělá to samé, jen ve formátu, kterému rozumí
i starší Xcode.

### „Signing for 'FlightLogger' requires a development team“

Nevybraný Team — krok 2 výš.

### „Failed to register bundle identifier“

Bundle ID už někdo má. Přepiš ho na jiný (krok 2, bod 2).

### „Unable to install… The developer is not trusted“

Na telefonu: *Nastavení → Obecné → VPN a správa zařízení → Důvěřovat*.

### Aplikace po týdnu zmizí nebo se nespustí

Free účet podepisuje na 7 dní. Znovu **⌘R** a je to.

### Chyby překladu ve Swiftu

Tady buď upřímný sám k sobě: **tenhle kód se nikdy nepřekládal.** Náhrady, které
šlo v prostředí bez toolchainu postavit, dohromady našly pět skutečných chyb:

| Co to našlo | Chyba |
|---|---|
| Statická kontrola volání proti deklaracím | Inicializátor `FlightRecorder` četl vlastní property dřív, než byly všechny nastavené — Swift to nepustí |
| Náhled rozhraní hnaný výstupem detektoru | Ukazatel „ověřuji změnu stavu“ svítil po celý let |
| Vykreslení trasy v tom náhledu | Simulovaný let „přistával“ 20 km od místa vzletu |
| Psaní testů k deníku | Přejmenování plochy neopravilo blokové události |
| Psaní testů k zapisovači | Pojíždění po hangáru zakládalo nové plochy |

Co nepokryly: **typovou kontrolu a dostupnost API.** To umí jenom překladač.

Co se tedy může objevit:

- **Nesedící typ v SwiftUI view** — nejpravděpodobnější. SwiftUI hlásí typové
  chyby matoucím způsobem („unable to type-check this expression in reasonable
  time“). Rozděl podezřelý `body` na menší `private var`.
- **API, které v iOS 17 ještě není.** Projekt cílí na 17.0 a používá
  `MapPolyline`, `Map(position:)`, `Map(initialPosition:)`,
  `ContentUnavailableView`, `Canvas` a `TimelineView` — všechno iOS 17. Kdyby si Xcode stěžoval,
  je to nejspíš překlep, ne chybějící API.
- **Chybějící soubor.** Nemělo by nastat: projekt používá synchronizované
  skupiny, takže každý `.swift` pod `FlightLogger/` a `FlightLoggerTests/` se
  přidá sám. Pokud by přesto: *File → Add Files to „FlightLogger“*.

Když něco spadne, pošli mi doslovné znění chyby i s názvem souboru a řádkem —
opravím to.

---

## Kde jsou data

Všechno je v `Application Support/FlightLogger` uvnitř sandboxu aplikace:

```
flights.json                deník
tracks/<uuid>.jsonl         trasa jednoho letu, bod po bodu
learned-airfields.json      plochy, které si aplikace založila nebo jsi je přejmenoval
airports.json               databáze letišť, pokud sis nějakou naimportoval
exports/                    co jsi vyexportoval
```

Ven se to dostane exportem: **GPX** u jednotlivého letu (otevře SeeYou, Google
Earth i většina deníků) a **CSV** celého deníku z ikony v Deníku. CSV má sloupce
`off_blocks`, `vzlet`, `pristani`, `on_blocks`, `doba_letu`, `blokovy_cas`
a `pojizdeni`.

Odinstalace aplikace smaže všechno — deník si předtím vyexportuj.

---

## Na co koukat při prvním reálném letu

1. **Zdroj terénu** na hlavní obrazovce. Zelený štítek „reference ze země“ =
   výšku nad zemí naměřila ta samá GPS, když letadlo stálo. To je ten dobrý stav.
2. **Senzory telefonu.** Až se barometr vynuluje (po chvíli stání se zapnutým
   záznamem), přepne se karta na „Výška nad zemí měřená barometrem“.
3. **Čas vzletu v kartě události.** Má být o pár sekund dřív než okamžik, kdy
   se stav přepnul — to je zpětné razítkování na skutečné odlepení kol.
4. **Prahy.** Jsou nastavené z rozumných hodnot, ne z naměřených dat. Po prvním
   letu se podívej do grafu, jakou rychlost a výšku tvůj stroj reálně drží, a
   v *Nastavení → Profil detekce* to doťukej.
