# Letový zapisovač (FlightLogger)

iOS aplikace, která si sama zapíše **vzlet a přistání** — pozná je z GPS podle
toho, že se zároveň změní **rychlost** a **výška nad terénem toho místa**.

Ne nad mořem. Nad terénem. To je celý vtip: letiště v 600 m n. m. je „vysoko“
pořád, takže samotná nadmořská výška nic neřekne. A samotná rychlost taky ne —
rychlé pojíždění po dráze nebo jízda autem po dálnici vypadá úplně stejně jako
odlet. Musí platit obojí najednou.

---

## Co to umí

| | |
|---|---|
| **Automatická detekce** | Vzlet a přistání se zapíšou samy, včetně touch & go |
| **Výška nad terénem (AGL)** | Ze čtyř zdrojů, seřazených tak, aby to fungovalo bez signálu |
| **Učí se plochy** | Letiště, které v databázi není (LKHN, Záhoří, louka), si zapamatuje samo |
| **Voda** | Vodní plochy, hydroplány — reference se sbírá i za pojíždění po hladině |
| **Deník** | Doba letu, odlet/přílet, max. výška, uletěná vzdálenost, nalétané hodiny |
| **Trasa** | Celý let bod po bodu, na mapě, export do GPX |
| **Export** | GPX na let, CSV na celý deník |
| **Záznam na pozadí** | S povolením polohy „Vždy“ zapisuje i se zhasnutým displejem |
| **Profily letadel** | Kluzák / ultralight / motorové / turbína, prahy se dají doladit |
| **Simulace** | Přehraje umělý let skrz stejnou detekci — vyzkoušíš to na zemi |
| **Ruční zápis** | Když detekce něco mine, zapíšeš to tlačítkem |

Data zůstávají v telefonu. Jediné, co jde ven, je volitelný dotaz na nadmořskou
výšku terénu.

---

## Jak detekce funguje

```
GPS fix ──▶ ověření přesnosti ──▶ rychlost + regrese stoupání
                                          │
                        výška terénu ─────┤
                    (4 zdroje, viz níže)  │
                                          ▼
                              obě podmínky současně?
                                          │
                             ano po dobu potvrzení
                                          ▼
                        událost zpětně orazítkovaná na okamžik,
                            kdy se kola opravdu odlepila
```

**Vzlet** = rychlost nad prahem typu letadla **a zároveň** výška nad terénem
nad prahem. V pásmu rotace (mezi „na zemi“ a „letím“) k tomu musí být i kladné
stoupání.

**Přistání** = nízko nad terénem **a zároveň** pomalu. Obojí zároveň — jinak by
se průlet ve 30 m při 100 kt zapsal jako přistání.

**Touch & go** má vlastní pravidlo: kola na dráze, klesání zastavené, ale
rychlost nikdy neklesne na pojížděcí. Vyžaduje o dost nižší výšku (polovina
prahu) a kratší potvrzení.

Tři věci, které dělají většinu práce v praxi:

- **Hystereze.** Práh pro vzlet je vždycky výš než pro přistání. Ten rozdíl
  brání překlápění stavu tam a zpět při poryvu nebo jednom špatném fixu.
- **Doba potvrzení.** Každá podmínka musí vydržet (výchozí 5 s). Jeden
  ustřelený fix nic nezapíše.
- **Zpětné razítko.** Událost se potvrdí až o pár sekund později, ale zapíše se
  na okamžik skutečného přechodu — detektor se prochází zpátky bufferem
  posledních 120 s a hledá, kde se to stalo. V deníku je čas odlepení kol, ne
  čas, kdy si tím aplikace byla jistá.

### Odkud se bere výška terénu

Pořadí je zvolené podle toho, co je ve vzduchu k dispozici — a tam obvykle není
signál, takže nic online nesmí být základ:

1. **Reference ze země** — medián výšky, kterou naměřila *ta samá* GPS, když
   letadlo stálo. Stejný přijímač, stejná systematická chyba, stejné místo. Pro
   domovské letiště přesnější než jakákoli mapa. Platí do 15 km a 12 hodin.
2. **Databáze ploch** — publikovaná nadmořská výška, offline. Sem patří i
   plochy, které si aplikace zapamatovala sama (viz níže).
3. **Cache** — dřív stažené dlaždice terénu (mřížka ~550 m, ukládá se natrvalo).
4. **Online** — Open-Meteo elevation API, na pozadí, nikdy neblokuje detekci.
   Výsledek jde do cache pro příště.

Když neodpoví žádný zdroj, detekce běží dál jen podle rychlosti a stoupání a
událost se označí jako **nejistá**. Radši nejistý zápis než žádný.

### Co detekce záměrně nezapíše

- Rychlé pojíždění nebo přerušený vzlet — rychlost ano, výška ne.
- Vzlet přes výpadek signálu delší než minutu — stav se resetuje a aplikace si
  nevymýšlí, co se dělo, když byla slepá.
- Vzlet, když aplikaci zapneš už za letu. Není žádný poctivý čas, který by se
  dal zapsat. Přistání se pak zapíše samostatně.

### Co může splést

Průlet nad dráhou níž než ~9 m nad terénem se zapíše jako přistání. Je to daň
za to, aby se chytily touch & go. Smaže se v deníku swipem.

---

## Plochy, které v žádné databázi nejsou

LKHN, Záhoří, travnatá plocha za vsí, louka souseda. Žádný veřejný dataset je
nepokrývá všechny a vypisovat je po paměti nemá cenu — špatná souřadnice nebo
špatná elevace je horší než žádná.

**Proč se vůbec zakládá „plocha“, a ne jen souřadnice?** Ze dvou důvodů, oba
praktické:

- **Deník.** `LKHN → LKZR` se čte, `50.7241, 15.0847 → 49.3012, 14.1877` ne.
- **Výška terénu offline.** Souřadnice si nic nepamatují. Plocha ano: jednou
  naměřená nadmořská výška u ní zůstane napořád, takže při příštím příletu má
  aplikace AGL hned, bez signálu a bez čekání, až letadlo chvíli postojí.

Nechceš to? **Nastavení → Terén → Zakládat plochy automaticky** vypni a neznámá
místa zůstanou v deníku jako souřadnice.

Jinak se aplikace plochy **učí za letu**:

1. Přistaneš někde, co nezná → založí si plochu `Plocha 1` na tom místě.
2. Než odletíš, chvíli stojíš se zapnutým záznamem → naměří si nadmořskou výšku
   té plochy a uloží si ji.
3. V **Nastavení → Terén → Plochy a letiště** ji jednou přejmenuješ na `LKHN`.
   Přejmenování opraví i lety, které už jsou v deníku zapsané.
4. Od té chvíle je LKHN plnohodnotná plocha — v deníku má jméno a výška nad
   zemí funguje **od prvního fixu po zapnutí, offline, bez signálu**, ještě než
   se letadlo rozjede.

Nechceš čekat na první přistání? **Přidat aktuální polohu** ve stejné obrazovce
zapíše plochu hned, i s naměřenou výškou, pokud už nějakou má.

Vlastní plochy mají přednost před datasetem, když jsou blíž. Naměřená výška
naopak **nikdy nepřepíše** publikovanou elevaci z datasetu — ruční GPS na to
není.

---

## Voda

Hydroplán, plovákový ultralight, vzlet z jezera nebo z moře. Funguje, ale dvě
věci jsou jinak než na trávě a obě jsou v kódu ošéfované:

**Hydroplán se nikdy nezastaví.** Na vodě pořád driftuješ a pojíždíš, klidně
5 kt od nastartování až po odlepení. Původní pravidlo sbíralo referenci terénu
jen pod 4 kt — na vodě by tedy nevznikla **nikdy**. Teď je práh odvozený od
typu letadla (polovina přistávací rychlosti, u motorového cca 16 kt) a rozhoduje
„jsem na hladině“, ne „stojím“. Navíc se vzorek zahodí, když už nějaký zdroj
tvrdí, že jsi vysoko — vrtulník ve visu referenci nepřepíše.

**Jezero není dráha.** Vzlétneš na jednom konci, přistaneš na druhém, a je to
pořád stejné vodní letiště. Plochu proto můžeš označit jako **vodní** a pak se
páruje na 6 km místo 2 km. Bez toho by z jednoho jezera byly tři plochy.

Co se výšky týče:

- **Moře** — terén je 0 m n. m., takže AGL vyjde rovno nadmořské výšce. Přesně
  jak má.
- **Jezero nebo přehrada** — hladina je výš než moře a výškové modely ji občas
  vracejí jako nulu. Proto je reference naměřená na hladině a uložená u té
  plochy důležitější než online dotaz: má před ním přednost. První let z nové
  vodní plochy může být proto pár sekund nepřesný (než se reference ustaví),
  každý další už ne.
- **Kolísání hladiny** — přehrada se v roce hne o metry, práh je 18 m. Nevadí.

Detekce samotná je na vodě stejná: rozjezd na step při 30–40 kt je pro aplikaci
totéž co rychlé pojíždění a **nezapíše se**, dokud se stroj neodlepí od hladiny.

---

## Sestavení

Potřebuješ Mac s Xcode 16 nebo novějším a iPhone s iOS 17+.

```bash
open flight-logger-ios/FlightLogger.xcodeproj
```

Pak v Xcode:

1. Vyber target **FlightLogger** → záložka *Signing & Capabilities*.
2. Nastav svůj **Team** (stačí bezplatný Apple ID účet) a změň
   `PRODUCT_BUNDLE_IDENTIFIER` na něco vlastního, např. `cz.tvojejmeno.FlightLogger`.
3. Připoj iPhone, vyber ho jako cíl, ⌘R.

Testy: ⌘U (nebo `xcodebuild test -scheme FlightLogger -destination 'platform=iOS Simulator,name=iPhone 15'`).

Kdyby projekt nešel otevřít (starší Xcode — soubor používá formát
`objectVersion 77`), vygeneruj ho znovu:

```bash
brew install xcodegen
cd flight-logger-ios && xcodegen generate
```

### Povolení polohy

Aplikace si řekne nejdřív o **Při používání** a pak o **Vždy**. Bez „Vždy“ se
zapisuje jen když je aplikace na obrazovce — na to je v nastavení přepínač
„nechat displej svítit při záznamu“. S „Vždy“ jede záznam i s telefonem v kapse
(`UIBackgroundModes: location`, GPS se nepozastavuje).

---

## Struktura

```
flight-logger-ios/
├── FlightLogger.xcodeproj/       # projekt (Xcode 16+, synchronizované skupiny)
├── project.yml                   # XcodeGen spec — záložní cesta
├── Info.plist                    # oprávnění polohy + background mode
├── FlightLogger/
│   ├── FlightLoggerApp.swift     # vstupní bod, TabView
│   ├── Core/                     # čistá logika, žádné CoreLocation → testovatelné
│   │   ├── Models.swift              Fix, FlightEvent, Flight, TrackPoint
│   │   ├── FlightDetector.swift      stavový automat vzlet/přistání
│   │   ├── DetectionProfile.swift    prahy podle typu letadla
│   │   ├── ElevationProvider.swift   kombinace čtyř zdrojů terénu
│   │   ├── AirportDatabase.swift     offline vyhledání letiště
│   │   ├── ElevationCache.swift      mřížka terénu na disku
│   │   ├── OnlineElevationClient.swift
│   │   ├── SyntheticTrack.swift      generátor umělých tras
│   │   └── GeoMath.swift             haversine, regrese, medián, jednotky
│   ├── Services/                 # I/O vrstva
│   │   ├── LocationService.swift     CoreLocation → Fix
│   │   ├── FlightRecorder.swift      lepí to dohromady
│   │   ├── FlightStore.swift         deník + trasy + export
│   │   ├── AppSettings.swift
│   │   └── AppPaths.swift
│   ├── Views/                    # SwiftUI (včetně AirfieldsView — správa ploch)
│   └── Resources/airports.json   # seed databáze letišť
├── FlightLoggerTests/            # XCTest — detekce, terén, geometrie
└── tools/
    ├── build-airports.mjs        # OurAirports CSV → airports.json
    └── detector-reference.py     # kontrolní přepis detektoru (viz níže)
```

`Core/` nezná CoreLocation ani SwiftUI. Proto se celá detekce dá pustit na
umělých trasách bez zařízení, bez GPS a bez dialogu o oprávnění.

---

## Databáze letišť

Přibalený seed (`FlightLogger/Resources/airports.json`) má 24 letišť —
souřadnice a kódy, ale **`elevation: null`**. To je záměr: přibližná poloha
stačí na pojmenování odletu, ale špatná nadmořská výška by šla rovnou do AGL, na
kterém stojí celá detekce. Radši žádné číslo než číslo po paměti.

Pro plochy, kde létáš, to řeší učení popsané výš — aplikace si výšku naměří
sama a je přesnější než tabulka. Pro zbytek světa se elevace doplní importem
veřejných dat:

```bash
curl -O https://davidmegginson.github.io/ourairports-data/airports.csv
node tools/build-airports.mjs airports.csv --country CZ,SK,AT,DE,PL > airports.json
```

Vzniklý soubor pak v aplikaci: **Nastavení → Terén → Importovat databázi
letišť**. Import má přednost před přibaleným seedem.

Test převodníku: `node --test tools/build-airports.test.mjs`.

---

## Co je ověřené a co ne

Poctivě, protože to není jedno:

**Ověřené:**

- Pravidlo pro sběr reference terénu (pojíždění ano, let ne, vis vrtulníku ne,
  drift hydroplánu ano) a párování vodních ploch přes celé jezero.
- Logika detekce na 11 scénářích — standardní let, letiště ve 2000 m, bez dat o
  terénu, touch & go, rychlé pojíždění, start za letu, rozbité fixy, desetiminutový
  výpadek signálu, přijímač bez údaje o rychlosti, kluzák se správným i se
  špatným profilem. Všechny sedí s tím, co tvrdí `FlightLoggerTests`.
  Kontrola běžela přes `tools/detector-reference.py` — řádek po řádku přepis
  téhož stavového automatu do Pythonu, protože na Linuxu není Swift.
  **Zdroj pravdy je Swift; ten Python soubor je jen kontrola.**
- `FlightLogger.xcodeproj` se načte parserem projektových souborů — obě cíle,
  všechny odkazy sedí, `objectVersion 77`.
- `Info.plist` je validní plist se správnými klíči.
- Převodník databáze letišť (6 testů, projdou).
- Během ověřování to našlo dvě skutečné chyby, obě opravené: detektor po výpadku
  signálu vymyslel vzlet, který nikdy neviděl, a touch & go se vůbec nedalo
  zachytit, protože letadlo nikdy nezpomalí na pojížděcí rychlost.

**Neověřené:**

- **Swift se nikde nezkompiloval.** V prostředí, kde tohle vzniklo, není
  toolchain a stažení blokuje síťová politika. První `⌘B` v Xcode může vyhodit
  překlepy.
- Chování CoreLocation na skutečném zařízení — přesnost, frekvence fixů, jak se
  chová záznam na pozadí za letu.
- Endpoint Open-Meteo se nedal zavolat (blokovaná síť). Klient je psaný podle
  dokumentovaného tvaru API a při jakékoli chybě mlčky vrátí „nevím“, takže
  případná změna API detekci nepoloží.
- Skutečný let. Prahy jsou odvozené z rozumných hodnot, ne z naměřených dat.
  Po prvním letu je nejspíš budeš chtít doladit v Nastavení.

---

## Kam dál

- Ověřit prahy na reálném letu a doladit profily.
- Barometrická výška z tlakoměru iPhonu (`CMAltimeter`) — mnohem tišší signál
  než GPS, ideální doplněk pro stoupání.
- Import celé databáze letišť rovnou v aplikaci (stáhnout, ne importovat soubor).
- Sdílení naučených ploch mezi zařízeními (iCloud).
- Widget / Live Activity s dobou letu na zamčené obrazovce.
- Export do formátu deníku (např. logbook CSV pro EASA formuláře).
