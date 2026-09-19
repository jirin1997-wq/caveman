# Letový zapisovač (FlightLogger)

iOS aplikace, která si sama zapíše **vzlet a přistání** — pozná je z GPS podle
toho, že se zároveň změní **rychlost** a **výška nad terénem toho místa**.

Ne nad mořem. Nad terénem. To je celý vtip: letiště v 600 m n. m. je „vysoko“
pořád, takže samotná nadmořská výška nic neřekne. A samotná rychlost taky ne —
rychlé pojíždění po dráze nebo jízda autem po dálnici vypadá úplně stejně jako
odlet. Musí platit obojí najednou.

---

> **Jak to dostat do telefonu:** [`BUILD.md`](BUILD.md) — postup v Xcode,
> spuštění testů a seznam chyb, které u prvního buildu reálně nastanou.

## Co to umí

| | |
|---|---|
| **Automatická detekce** | Vzlet a přistání se zapíšou samy, včetně touch & go |
| **Výška nad terénem (AGL)** | Ze čtyř zdrojů, seřazených tak, aby to fungovalo bez signálu |
| **Učí se plochy** | Letiště, které v databázi není (LKHN, Záhoří, louka), si zapamatuje samo |
| **Voda** | Vodní plochy, hydroplány — reference se sbírá i za pojíždění po hladině |
| **Deník** | Doba letu, odlet/přílet, max. výška, uletěná vzdálenost, nalétané hodiny |
| **Živá mapa** | Trasa se kreslí **při letu**, ne až potom. Na celou obrazovku i jako karta |
| **Graf průběhu** | Rychlost, stoupání/klesání a výška nad zemí na společné časové ose |
| **Graf ↔ mapa** | Potáhnutím po grafu se na mapě ukáže, kde letadlo v tu chvíli bylo |
| **Poznámka k letu** | Registrace a volný text, co aplikace sama vědět nemůže |
| **Letový i blokový čas** | Vzlet→přistání a zvlášť vyjetí→zastavení, včetně pojíždění |
| **Barometr + akcelerometr** | Výška nad zemí a stoupání z tlakoměru, mnohem tišší než GPS |
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

## Mapa a graf za letu

Mapa nekreslí trasu až v hotovém letu — kreslí ji průběžně, od chvíle, kdy
zapneš záznam. Vidíš tedy i pojíždění, ne jen let. Karta na hlavní obrazovce se
rozklikne na celou obrazovku, kde jsou přes mapu jen tři čísla: GS, AGL a
stoupání.

Pod mapou je graf se třemi pruhy na společné časové ose:

- **rychlost** (kt),
- **stoupání/klesání** (fpm, s nulovou linkou),
- **výška nad zemí** (ft).

Tři pruhy místo jednoho grafu proto, že uzel, stopa za minutu a stopa spolu
nemají co dělat — každá čára si tak drží vlastní rozsah a čitelnost, a časová
osa pořád dovolí přiložit „tady začalo stoupání" k „tady spadla rychlost".

Kreslí se z **zředěné** kopie trasy: na disk jde záznam v plné sekundové
hustotě, ale pro vykreslení se drží strop 1500 bodů. Když se naplní, zahodí se
každý druhý bod a jede se na poloviční hustotě. Trasa si udrží tvar i oba konce,
ztratí se jen detail, který stejně na displeji telefonu nikdo nerozliší.

Jedna věc na rovinu: **dlaždice Apple map potřebují signál.** Ve vzduchu
většinou není, takže čekej prázdnou mřížku. Trasa se na ni ale kreslí dál —
čára je ze zapisovače, ne z mapy. Co si telefon stáhl na zemi, zůstane
dostupné.

---

## Detail letu

Mapa a graf nad sebou nejsou dvě oddělené věci. **Potáhni prstem po kterémkoli
pruhu grafu** a na mapě naskočí značka v místě, kde letadlo v tu chvíli bylo —
a čísla nad pruhy přepnou z konce letu na ten vybraný okamžik. Odpovídá to na
otázku, kterou jinak z grafu nevyčteš: *kde* se to stalo, ne jen kdy.

Registrace letadla a poznámka se dají dopsat ručně (tužka vpravo nahoře) —
jsou to jediné dvě věci, které aplikace sama vědět nemůže. Označení
touch & go si aplikace tipne sama a tady se dá opravit.

---

## Letový a blokový čas

Deník chce obě čísla a jedno z druhého nespočítáš:

- **doba letu** — odlepení kol až dosednutí,
- **blokový čas** — od chvíle, kdy se letadlo poprvé rozjede, do chvíle, kdy
  definitivně zastaví. Pojíždění na obou koncích včetně.

Aplikace detekuje obojí zvlášť. Rozjezd se potvrzuje 10 s nad 4 kt, zastavení
**45 s** pod 1,5 kt — ta dlouhá prodleva je schválně: **stání před dráhou není
konec letu.** Pojíždění bez letu (přetažení do hangáru) vyrobí jen dvojici
blokových událostí a žádný let; ta se zahodí.

V deníku pak vidíš u každého letu obojí, v souhrnu nalétané hodiny i blok, a
v CSV exportu jsou sloupce `off_blocks`, `on_blocks`, `blokovy_cas` a
`pojizdeni`.

---

## Barometr a akcelerometr

Chtěl jsi akcelerometr. Přidal jsem ho — ale rovnou říkám, že **ten senzor, co
tomu opravdu pomůže, je barometr**, a je v tom stejném API.

**Barometr dělá tu těžkou práci.** Výška z GPS je to nejšumivější, co přijímač
hlásí — ±8 m je dobrý den, a detektor ji musí prokládat regresí přes šest
sekund, jen aby z ní dostal použitelné stoupání. Tlakoměr v iPhonu rozliší
*relativní* výšku na jednotky centimetrů a hlásí ji jednou za sekundu. Nadmořskou
výšku ti neřekne — ale to po něm nikdo nechce: vynuluj ho na zemi a odpoví na
otázku „jak vysoko nad tím místem jsem" líp než cokoli jiného v telefonu.
Nuluje se při každém kontaktu se zemí, což zároveň řeší, aby se nenasčítal
pomalý posun tlaku s počasím (řádově hPa za hodinu, asi 8 m).

Když barometr má co měřit, má přednost před AGL z GPS a událost dostane
značku „jistý" bez ohledu na terén.

**Akcelerometr přitakává.** Telefon volně v kapse nemá známou orientaci, takže
z něj není poctivá cesta ke zrychlení dopředu — jen k velikosti měrné síly, což
je na orientaci nezávislé. I to stojí za to: říká, že letadlo je pod výkonem a
v pohybu (ukazuje se na hlavní obrazovce), a hlavně **zahodí vzorek terénní
reference vzniklý při poskakování po trávě**, aby se nepovažoval za stojící
letadlo.

Obojí je nepovinné. Starší telefon barometr nemá, uživatel může přístup k pohybu
odmítnout — detekce běží dál, jen hruběji. Předání `nil` místo měření nechá
detektor chovat se přesně jako dřív.

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
│   │   ├── MotionSample.swift        barometr + akcelerometr, reference tlaku
│   │   ├── TrackBuffer.swift         zředěná kopie trasy pro vykreslení
│   │   └── GeoMath.swift             haversine, regrese, medián, jednotky
│   ├── Services/                 # I/O vrstva
│   │   ├── LocationService.swift     CoreLocation → Fix
│   │   ├── MotionService.swift       CoreMotion → MotionSample
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

- Umělé trasy se vracejí na výchozí plochu (dřív odlétaly 20 km na východ a
  deník přitom tvrdil návrat na stejné letiště) a přitom se opravdu někam
  dostanou.
- Blokové časy na pěti scénářích: celý let vyrobí čtyři události ve správném
  pořadí, blok je delší než let, událost je orazítkovaná zpětně, stání před
  dráhou blok neukončí, a pojíždění bez letu nevyrobí žádný vzlet.
- Fúze se senzory: barometrická výška detekuje let i bez jakýchkoli dat o terénu,
  prázdné měření nezmění chování ani o vteřinu, a rozhýbaný telefon nesmí
  definovat zem.
- Ořezávání trasy pro vykreslení: strop se drží, oba konce trasy přežijí,
  pořadí sedí.
- Pravidlo pro sběr reference terénu (pojíždění ano, let ne, vis vrtulníku ne,
  drift hydroplánu ano) a párování vodních ploch přes celé jezero.
- Logika detekce na 11 scénářích — standardní let, letiště ve 2000 m, bez dat o
  terénu, touch & go, rychlé pojíždění, start za letu, rozbité fixy, desetiminutový
  výpadek signálu, přijímač bez údaje o rychlosti, kluzák se správným i se
  špatným profilem. Všechny sedí s tím, co tvrdí `FlightLoggerTests`.
  Kontrola běžela přes `tools/detector-reference.py` — řádek po řádku přepis
  téhož stavového automatu do Pythonu, protože na Linuxu není Swift.
  **Zdroj pravdy je Swift; ten Python soubor je jen kontrola.**
- Statická kontrola Swiftu místo kompilátoru: každé volání v modulu proti
  deklaraci (argumentové labely, počty parametrů) a každý použitý typ proti
  deklarovaným. Našlo to jednu skutečnou chybu — inicializátor `FlightRecorder`
  četl vlastní property dřív, než byly všechny nastavené, což Swift nepustí.
  Opraveno.
- `FlightLogger.xcodeproj` se načte parserem projektových souborů — obě cíle,
  všechny odkazy sedí, `objectVersion 77`.
- `Info.plist` je validní plist se správnými klíči.
- Převodník databáze letišť (6 testů, projdou).
- Během ověřování to našlo dvě skutečné chyby, obě opravené: detektor po výpadku
  signálu vymyslel vzlet, který nikdy neviděl, a touch & go se vůbec nedalo
  zachytit, protože letadlo nikdy nezpomalí na pojížděcí rychlost.

**Neověřené:**

- **Swift se nikde nezkompiloval.** V prostředí, kde tohle vzniklo, není
  toolchain a stažení blokuje síťová politika. Statické kontroly výš pokryjí
  labely, typy a párování závorek, ale ne typovou kontrolu ani dostupnost API —
  první `⌘B` v Xcode může pořád něco vyhodit.
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
