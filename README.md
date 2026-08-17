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
| **Rádio mezi uživateli** | tenhle server | Opravdový chat mezi lidmi připojenými k téhle instanci. **Není to ATC** a je to tak i označené v UI. |

Co v aplikaci **není**: žádný generátor „realistických" ATC hlášek, žádná náhodná letadla dosazená místo chybějících dat. Dřívější verze tohle měla a označovala to jako „LIVE" — bylo to smyšlené a je to pryč.

---

## Co v aplikaci uvidíš

**Radar** — 2D scope kolem letiště, dosah 90 km. Klikni na letadlo (nebo na řádek v tabuli) a vpravo se otevře detail.

**Detail letadla** — fotka konkrétního trupu, typ (`AIRBUS A-321neo · A21N`), imatrikulace, provozovatel, rok výroby, kategorie a třída turbulence, výška, rychlost, kurz, stoupání, squawk a vzdálenost od letiště. Nouzové squawky (7500 únos / 7600 ztráta spojení / 7700 nouze) se zvýrazní červeně.

**Přepínače pozic** — Clearance · Ground · Tower · Approach · Departure · Radar/ACC · ATIS. Zobrazí se jen ty, pro které LiveATC u daného letiště opravdu feed má. Když má pozice víc feedů (např. Tower North/South), přibude druhý výběr.

**Tabule provozu** — čtyři záložky: Přílety 🛬 / Odlety 🛫 / Na zemi 🅿 / Přelety ✈, s počtem u každé.

---

## Spuštění

### Možnost 0: Webová stránka (nic se neinstaluje)

`web/index.html` je celá aplikace v jednom souboru — radar, tabule i detaily
letadel. Otevřeš ji v prohlížeči a jede. Žádný Node, žádný build.

Chceš ji mít i na vlastní adrese (pro mobil, pro čtení z práce)? Jednou zapni
**Settings → Pages → Source: GitHub Actions**, pak se každý push sám vystaví
přes `.github/workflows/deploy-web.yml`. To zapnutí musí udělat člověk —
token, kterým běží workflow, Pages založit nesmí.

Běží ve dvou režimech a sama pozná, ve kterém je:

| | **přímý** (samotná stránka) | **backend** (+ lokální server) |
|---|---|---|
| Radar a provoz | ano, pokud API pustí volání z prohlížeče | ano, vždy |
| Detaily a fotky letadel | ano, pokud API pustí volání z prohlížeče | ano, vždy |
| **Živé ATC audio** | **ne** — odkaz na LiveATC | **ano, přímo ve stránce** |

Zvuk v přímém režimu nejde a nepředstírá se, že jde: LiveATC nepouští
přehrávání z cizích webů. Tlačítko proto vede na jejich vlastní přehrávač.

Chceš zvuk ve stránce? Pusť server z tohohle repa a řekni o něm stránce:

```bash
npm install
npm run dev:server        # poslouchá na :3001
```

Pak ve stránce klikni na **backend** a zadej `http://localhost:3001`
(nebo otevři `index.html?backend=http://localhost:3001`). Adresa se pamatuje.

### Možnost 1: Stáhnout hotovou appku z GitHubu (bez terminálu)

Nemusíš nic buildit — postaví to GitHub za tebe, na všechny tři systémy:

1. na GitHubu jdi do záložky **Actions**
2. vlevo vyber **Build desktop app**, vpravo klikni **Run workflow** (větev `claude/atc-radio-app-2xj5fz`)
3. počkej ~10 minut, otevři doběhlý běh
4. dole v sekci **Artifacts** stáhni podle svého systému:
   - `atc-radio-windows` → `.exe` instalátor
   - `atc-radio-macos` → `.dmg`
   - `atc-radio-linux` → `.AppImage`

Rozbalíš ZIP, spustíš — appka si sama nastartuje server i okno. Node ani terminál k tomu nepotřebuješ.

> Appka není podepsaná certifikátem (ten stojí stovky dolarů ročně). Windows ukáže „SmartScreen: neznámý vydavatel" → **Více informací → Přesto spustit**. macOS → klikni pravým a **Otevřít**.

### Možnost 2: Postavit appku u sebe

```bash
npm install
npm run build:electron
```

Vytvoří `dist/ATC Radio-1.0.0.AppImage` (Linux), `.exe` (Windows) nebo `.dmg` (Mac) — vždy pro systém, na kterém to pouštíš. Křížem to nejde: Windows build z Linuxu potřebuje wine, macOS build jen macOS. Proto ta CI výše.

### Možnost 3: Web dev (pro vývoj)

```bash
npm install
npm run dev
```

- frontend → http://localhost:3000
- backend → http://localhost:3001

Otevři `localhost:3000`, nahoře vyber letiště, vpravo zapni `▶ poslouchat`.

### Možnost 4: Electron dev (s hot reload)

```bash
npm install
npm run dev:electron
```

Otevře okno Electronu s live reloadu během vývoje.

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

44 testů, doběhnou za necelou vteřinu, **žádný nepotřebuje síť**. Testuje se to, kde bugy skutečně bývají — parsování cizích dat:

- rozbor stránky LiveATC a `.pls` playlistu (včetně případu „letiště feed nemá")
- zařazení feedů do pozic podle id i podle popisku
- normalizace ADS-B payloadu — že se `alt_baro: "ground"` přeloží na 0 ft, že chybějící imatrikulace zůstane `null`, že letadlo bez pozice vypadne
- dekódování nouzových squawků a kategorií
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
