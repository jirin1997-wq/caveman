# ✈️ ATC Radio

Živý provoz a živé ATC audio pro Ruzyň a další letiště. Běží lokálně.

---

## Co je živé a co ne — čti první

Aplikace je postavená na pravidle: **co není opravdové, netváří se jako opravdové.**

| Část | Odkud | Poznámka |
|---|---|---|
| **ATC audio** | LiveATC.net | Opravdový zvuk z opravdové frekvence. Feed se hledá za běhu — nic není natvrdo v kódu. |
| **Provoz na radaru** | adsb.lol → airplanes.live → OpenSky | Opravdová ADS-B data. Když žádný zdroj neodpoví, radar zůstane **prázdný** a napíše proč. |
| **Typ letadla, imatrikulace, provozovatel** | databáze ADS-B sítě | Co transpondér nebo databáze nepošle, zůstane prázdné (pomlčka). Nikdy se nedoplňuje odhadem. |
| **Fotky letadel** | Planespotters API | Hledá se podle hex kódu, který letadlo vysílá — takže je to **ten konkrétní trup nad tebou**, ne obecná fotka typu. S povinným uvedením autora. |
| **Tabule příletů/odletů** | odvozeno z živých ADS-B | Kdo klesá k letišti, kdo stoupá pryč, kdo stojí na zemi. **Není to letový řád** — ten by chtěl placený zdroj, a ten si nevymýšlím. |
| **Zdroj polohy (ADS-B / MLAT / TIS-B)** | pole `type` v odpovědi sítě | Rozlišuje **vysílanou** polohu od **dopočtené**. Co síť neoznačí, zůstane bez popisku — nedosazuje se „ADS-B" jen proto, že je nejčastější. |
| **Rádio mezi uživateli** | tenhle server | Opravdový chat mezi lidmi připojenými k téhle instanci. **Není to ATC** a je to tak i označené v UI. |

Co v aplikaci **není**: žádný generátor „realistických" ATC hlášek, žádná náhodná letadla dosazená místo chybějících dat. Dřívější verze tohle měla a označovala to jako „LIVE" — bylo to smyšlené a je to pryč.

---

## Co v aplikaci uvidíš

**Radar** — 2D scope kolem letiště, dosah 90 km. Klikni na letadlo (nebo na řádek v tabuli) a vpravo se otevře detail.

**Detail letadla** — fotka konkrétního trupu, typ (`AIRBUS A-321neo · A21N`), imatrikulace, provozovatel, rok výroby, kategorie a třída turbulence, výška, rychlost, kurz, stoupání, squawk a vzdálenost od letiště. Nouzové squawky (7500 únos / 7600 ztráta spojení / 7700 nouze) se zvýrazní červeně.

**Přepínače pozic** — Clearance · Ground · Tower · Approach · Departure · Radar/ACC · ATIS. Zobrazí se jen ty, pro které LiveATC u daného letiště opravdu feed má. Když má pozice víc feedů (např. Tower North/South), přibude druhý výběr.

**Tabule provozu** — čtyři záložky: Přílety 🛬 / Odlety 🛫 / Na zemi 🅿 / Přelety ✈, s počtem u každé.

**Rádio** — chat mezi lidmi připojenými k témuž serveru, kanál podle letiště.
Volačka + role (pilot / ATC). **Není to ATC komunikace** — ta skutečná je ve
zvuku z LiveATC o panel výš, a v UI je ten rozdíl napsaný.

---

## Vysílaná poloha vs. dopočtená (MLAT)

Ne každé letadlo na radaru svoji polohu vysílá.

**ADS-B** — letadlo samo hlásí, kde je. Přesné, a je toho většina.

**MLAT** — letadlo vysílá jen odpověď transpondéru bez polohy. Několik přijímačů
zachytí ten samý signál v mírně jiný okamžik a z rozdílu časů se poloha
**dopočítá**. Je to odhad s chybou, ne měření. Přesně tohle má FlightRadar24
navíc a proto vidí i pár letadel, která by jinak chyběla.

Sítě `adsb.lol` a `airplanes.live` ten výpočet dělají a výsledek posílají spolu
s ADS-B; OpenSky totéž hlásí číslem v `position_source`. Aplikace obojí zobrazí,
ale **nesmí to splynout**:

- na radaru je vysílaná poloha **plný** trojúhelník ▲, dopočtená jen **obrys** △
- v detailu je řádek `Poloha` (`ADS-B` / `MLAT (dopočet)` / `TIS-B` / …) a pod ním
  věta, co to znamená
- když síť zdroj polohy neuvede, **řádek se nezobrazí vůbec** — místo aby se
  hádalo

Samotný MLAT výpočet dělat neumíme a nikdy nebudeme: potřebuje syrové časy
příjmu z několika přijímačů se synchronizovanými hodinami, a ta data žádná síť
veřejně nepouští.

---

## Spuštění

### Takhle. Dva příkazy, funguje všechno.

```bash
npm install
npm run dev:server
```

Otevři **http://localhost:3001** — a je to. Radar, tabule, detaily letadel
i **živé ATC audio**. Nic se nenastavuje: stránku servíruje ten samý server,
který volá API, takže je to jeden origin a CORS nemá co blokovat.

To je celé. Zbytek téhle sekce jsou varianty pro zvláštní případy.

---

### Varianta: otevřít `web/index.html` přímo ze souboru

Jde to, ale je to nejslabší cesta a stojí za to vědět proč.

Stránka pak nemá backend a musí na ADS-B API sáhnout sama z prohlížeče.
Jenže dokument otevřený jako `file://` má **prázdný origin** a veřejná API
takové volání běžně odmítnou — pak uvidíš prázdný radar a výpis, který zdroj
selhal a proč. Není to rozbitá aplikace, je to poctivá odpověď.

Zvuk tudy nejde vůbec: LiveATC nepouští přehrávání z cizích webů (CORS
+ ochrana proti hotlinkování). Místo mrtvého tlačítka je tam odkaz na jejich
vlastní přehrávač.

| | **přímý** (samotný soubor) | **backend** (`localhost:3001`) |
|---|---|---|
| Radar a provoz | jen když API pustí prohlížeč | vždy |
| Detaily a fotky letadel | jen když API pustí prohlížeč | vždy |
| **Živé ATC audio** | ne — odkaz na LiveATC | **ano, ve stránce** |

Máš už server puštěný a stránku otevřenou odjinud? Klikni nahoře na
**backend** a zadej `http://localhost:3001` (nebo otevři
`index.html?backend=http://localhost:3001`). Adresa se pamatuje.

### Varianta: vlastní veřejná adresa (GitHub Pages)

Jednou zapni **Settings → Pages → Source: GitHub Actions** a každý push se sám
vystaví přes `.github/workflows/deploy-web.yml`. To zapnutí musí udělat člověk —
token, kterým běží workflow, Pages založit nesmí.

Pozor, co tím dostaneš: Pages hostí **jen statickou stránku**, ne backend.
Platí pro ni všechno z odstavce výše — data jen pokud je API pustí, zvuk
odkazem. Backend veřejně nasazený být nemá: proxy na cizí ATC zvuk by z osobního
poslechu udělala redistribuci, kterou podmínky LiveATC zakazují.

### Varianta: stáhnout hotovou appku z GitHubu (bez terminálu)

Nemusíš nic buildit — postaví to GitHub za tebe, na všechny tři systémy:

1. na GitHubu jdi do záložky **Actions**
2. vlevo vyber **Build desktop app**, vpravo klikni **Run workflow** (větev `claude/atc-radio-app-2xj5fz`)
3. počkej ~10 minut, otevři doběhlý běh
4. dole v sekci **Artifacts** stáhni podle svého systému:
   - `atc-radio-windows` → `.exe` instalátor
   - `atc-radio-macos` → `.dmg`
   - `atc-radio-linux` → `.AppImage`

Rozbalíš ZIP, spustíš — appka si sama nastartuje server i okno. Node ani terminál k tomu nepotřebuješ.

> **Zatím neověřeno.** Dřívější balíček byl rozbitý: okno načítalo port 3000, kde
> v hotové appce nic neposlouchalo. Opraveno (okno teď načítá vnitřní server na
> 3001, stejně jako varianta výše), ale nepodařilo se mi zabalenou appku
> odzkoušet — až ji spustíš, dej vědět, jestli naběhne.

> Appka není podepsaná certifikátem (ten stojí stovky dolarů ročně). Windows ukáže „SmartScreen: neznámý vydavatel" → **Více informací → Přesto spustit**. macOS → klikni pravým a **Otevřít**.

### Varianta: postavit appku u sebe

```bash
npm install
npm run build:electron
```

Vytvoří `dist/ATC Radio-1.0.0.AppImage` (Linux), `.exe` (Windows) nebo `.dmg` (Mac) — vždy pro systém, na kterém to pouštíš. Křížem to nejde: Windows build z Linuxu potřebuje wine, macOS build jen macOS. Proto ta CI výše.

### Varianta: React verze (pro vývoj)

Vedle jednosouborové stránky žije i původní Next.js/React aplikace — má navíc
chat mezi uživateli, který statická verze nemá.

```bash
npm install
npm run dev
```

- React frontend → http://localhost:3000
- backend → http://localhost:3001

### Varianta: Electron dev

```bash
npm install
npm run dev:electron
```

Spustí server a otevře nad ním okno Electronu.

---

## Proč audio potřebuje backend

Prohlížeč si zvuk z LiveATC nestáhne sám — brání tomu CORS a ochrana proti hotlinkování. Proto stream stahuje **Node backend** a posílá ho dál do tvého prohlížeče:

```
LiveATC.net ──▶ tvůj Node server ──▶ tvůj prohlížeč
             (server-side fetch)   (jen localhost, žádné CORS)
```

Statická stránka bez backendu tohle udělat nemůže — proto v přímém režimu odkazuje na přehrávač LiveATC místo toho, aby předstírala vlastní.

U ADS-B je to otevřenější: některá API volání z prohlížeče pouštějí, jiná ne, a nedá se to slíbit dopředu. Stránka to proto zkusí a když ji CORS zastaví, **napíše to** — místo aby ukázala prázdný radar bez vysvětlení.

---

## Jak se hledají feedy

Nic se nehádá. Postup za běhu:

1. `GET liveatc.net/search/?icao=LKPR` → které feedy pro letiště existují
2. `GET liveatc.net/play/<feed>.pls` → aktuální adresa streamu (CDN hostname se mění)
3. server ji otevře a pipne do prohlížeče

Když LiveATC pro dané letiště feed nemá, UI to napíše. To je legitimní odpověď — ne každé letiště je pokryté, a to včetně LKPR se může měnit.

---

## Letiště

LKPR Praha/Ruzyně · LKTB Brno · LKMT Ostrava · EDDF Frankfurt · EHAM Amsterdam · EGLL Heathrow · LOWW Wien · KJFK New York

Přidání dalšího = jeden řádek v `server/airports.js` **a v `web/index.html`** (ICAO + souřadnice); test hlídá, že se ty dva seznamy shodují. Frekvence se nezadávají ručně — přebírají se z LiveATC, aby v aplikaci nemohla být špatná frekvence.

---

## Testy

```bash
npm test
```

47 testů, doběhnou za pár vteřin, **žádný nepotřebuje síť**. Testuje se to, kde bugy skutečně bývají — parsování cizích dat:

- rozbor stránky LiveATC a `.pls` playlistu (včetně případu „letiště feed nemá")
- zařazení feedů do pozic podle id i podle popisku
- normalizace ADS-B payloadu — že se `alt_baro: "ground"` přeloží na 0 ft, že chybějící imatrikulace zůstane `null`, že letadlo bez pozice vypadne
- dekódování nouzových squawků a kategorií
- že se **dopočtená poloha označí jako odhad** a vysílaná ne, a že neznámý zdroj polohy nedostane popisek
- geometrie tabule: že brněnské letadlo nespadne do pražského „na zemi"
- celá HTTP cesta proti podvržené síti, včetně toho, že **výpadek zdroje vrátí `live:false` s důvody, ne vymyšlený provoz**
- že webová verze počítá **úplně stejně jako server** — stejná letiště, stejná normalizace, stejné zařazení do tabule

Poslední dva jsou tam schválně. Ten první je pojistka přesně proti chybě, kterou dřívější verze téhle aplikace dělala. Ten druhý hlídá, že se kopie logiky v `web/index.html` časem tiše nerozejde se serverem — obě obrazovky by dál fungovaly, jen by o stejném letadle tvrdily každá něco jiného.

---

## Struktura

```
web/
  index.html        celá webová verze v jednom souboru (bez buildu)
server/
  airports.js       letiště (ICAO + souřadnice, nic víc)
  liveatc.js        hledání feedů + rozbalení .pls na adresu streamu
  positions.js      zařazení feedů do pozic (Ground / Tower / Approach …)
  adsb.js           živý provoz, tři zdroje za sebou, poctivé selhání
  aircraft-meta.js  význam kategorií a squawků (ze specifikace ADS-B)
  movements.js      tabule příletů/odletů odvozená z geometrie
  photos.js         fotky přes Planespotters, podle hex kódu
  radio.js          chat mezi uživateli (ne ATC)
  index.js          REST + WebSocket + audio proxy
app/
  page.jsx          layout, výběr letiště, websocket
  components/       RadarMap · RadioPanel · MovementBoard · InfoPanel
  store.js          zustand
tests/              35 testů, offline
```

---

## Podmínky použití

LiveATC ve svých podmínkách **zakazuje přeposílání a redistribuci** svého zvuku. Proxy na vlastním počítači pro vlastní poslech je osobní použití. **Nenasazuj tohle na veřejnou URL** — tím by ses dostal do redistribuce. To je zároveň důvod, proč to není nikde nasazené jako veřejný odkaz.

ADS-B zdroje (adsb.lol, airplanes.live, OpenSky) jsou komunitní a bez klíče mají rate limity. Dotazuje se jednou za 8 sekund a jen na letiště, které někdo skutečně sleduje.

---

## Známá omezení

- Chat je in-memory — restart serveru historii smaže.
- Radar je 2D scope kolem letiště v dosahu 90 km, ne mapa s terénem.
- Feedy někdy vypadnou i když existují (dobrovolníci vypnou přijímač). UI ukáže `stream se nepodařilo otevřít`.
