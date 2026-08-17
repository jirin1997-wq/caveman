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

### Možnost 1: Desktop appka (nejjednoduší)

```bash
npm install
npm run build:electron
```

Vytvoří soubor `dist/ATC-Radio-*.exe` (Windows), `.dmg` (Mac) nebo `.AppImage` (Linux). Stáhneš a spustíš — nic víc.

### Možnost 2: Web dev (pro vývoj)

```bash
npm install
npm run dev
```

- frontend → http://localhost:3000
- backend → http://localhost:3001

Otevři `localhost:3000`, nahoře vyber letiště, vpravo zapni `▶ poslouchat`.

### Možnost 3: Electron dev (s hot reload)

```bash
npm install
npm run dev:electron
```

Otevře okno Electronu s live reloadu během vývoje.

---

## Proč to musí běžet lokálně

Prohlížeč si audio z LiveATC nestáhne sám — brání tomu CORS a ochrana proti hotlinkování. Proto stream stahuje **Node backend** a posílá ho dál do tvého prohlížeče:

```
LiveATC.net ──▶ tvůj Node server ──▶ tvůj prohlížeč
             (server-side fetch)   (jen localhost, žádné CORS)
```

Stejný důvod platí pro ADS-B API. Cokoliv hostovaného v prohlížeči bez vlastního backendu (např. statická stránka) tohle udělat nemůže.

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

Přidání dalšího = jeden řádek v `server/airports.js` (ICAO + souřadnice). Frekvence se nezadávají ručně — přebírají se z LiveATC, aby v aplikaci nemohla být špatná frekvence.

---

## Testy

```bash
npm test
```

35 testů, doběhnou za necelou vteřinu, **žádný nepotřebuje síť**. Testuje se to, kde bugy skutečně bývají — parsování cizích dat:

- rozbor stránky LiveATC a `.pls` playlistu (včetně případu „letiště feed nemá")
- zařazení feedů do pozic podle id i podle popisku
- normalizace ADS-B payloadu — že se `alt_baro: "ground"` přeloží na 0 ft, že chybějící imatrikulace zůstane `null`, že letadlo bez pozice vypadne
- dekódování nouzových squawků a kategorií
- geometrie tabule: že brněnské letadlo nespadne do pražského „na zemi"
- celá HTTP cesta proti podvržené síti, včetně toho, že **výpadek zdroje vrátí `live:false` s důvody, ne vymyšlený provoz**

Poslední jmenovaný test je tam schválně — je to pojistka přesně proti té chybě, kterou dřívější verze téhle aplikace dělala.

---

## Struktura

```
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
