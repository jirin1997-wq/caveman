# 🏠 Reality Scout

Srovnávač nemovitostí pro Prahu a Brno. Stahuje inzeráty, počítá cenu za m²,
porovnává ji se srovnatelnými nemovitostmi a sleduje vývoj trhu v čase.

## Co to umí

**Vyhledávání a filtrování**
- Novostavby / byty
- Dispozice (1+kk až 6+1, atypické)
- Cenové rozmezí v Kč i v Kč/m², s histogramem rozložení trhu
- Plocha, typ stavby (cihla / panel / smíšená), stav objektu
- Vybavenost — balkón, terasa, lodžie, sklep, výtah, garáž, parkování
- Lokalita, zdroj inzerátu, rok dokončení, jen zlevněné, jen činžovní domy

**Vyhodnocení ceny**
- **Cenový rating** — pětistupňová škála od „Výborná cena" po „Vysoká cena".
  Porovnává cenu za m² s mediánem srovnatelných nemovitostí. Srovnávací
  skupina se vybírá od nejpodrobnější (stejná čtvrť + dispozice) k nejširší,
  podle toho, kde je dost dat. U každé nemovitosti je vidět, vůči čemu se měří.
- **Hrubý výnos z pronájmu** (% p.a.) — roční nájem podle referenčních
  nájmů v lokalitě dělený kupní cenou. Nízký výnos = drahé vůči nájemnímu trhu.
- **Doba na trhu** — jak dlouho inzerát visí.

**Přehled trhu**
- Mapa s body obarvenými podle cenového ratingu
- Vývoj mediánu ceny za m² za posledních 24 měsíců
- Historie ceny konkrétního inzerátu včetně zlevnění

**Kalkulačka**
- Měsíční splátka, celkem zaplacené úroky, LTV s upozorněním nad 80 %
- Dostupnost: DSTI a kolik let čistého příjmu nemovitost stojí

## Rychlý start

```bash
cp .env.example .env
npm install
cd frontend && npm install && cd ..

# Databáze — buď Docker…
npm run docker:up

# …nebo lokální PostgreSQL:
#   createuser realestateuser -P --createdb
#   createdb realestate_db -O realestateuser

npm run db:migrate
npm run db:seed        # demo data, ať je co prohlížet
npm run dev
```

- Web: http://localhost:3000
- API: http://localhost:5000

> `npm run db:seed` naplní databázi **vymyšlenými** daty v realistických řádech.
> Slouží k vývoji a prohlídce UI. Reálná data přinese scraper.

## Stažení reálných dat

```bash
npm run scrape          # všechny zdroje + snímek trhu (co dělá i noční cron)
npm run scrape:all      # alias pro scrape
npm run scrape:sreality # jen Sreality
npm run scrape:idnes    # jen iDNES Reality
npm run scrape:bezrealitky # jen Bezrealitky
npm run scrape:developers  # jen developer websites (Praha)
npm run snapshot        # jen přepočet snímku trhu
```

### Stav jednotlivých zdrojů — čti před spuštěním

Scrapery **nebyly ověřeny proti živým webům**. Vývojové prostředí má striktní
allow-list odchozích spojení, takže na sreality.cz ani na ostatní zdroje se
z něj nedá připojit (403 na CONNECT). Endpointy a selektory jsou tedy napsané
podle očekávaného tvaru, ne podle skutečné odpovědi serveru.

| Zdroj | Mechanismus | Důvěra |
|---|---|---|
| Sreality.cz | `api/cs/v2/estates` | **Střední** — jde o veřejné API, které pohání jejich vlastní web. Tvar odpovědi je pravděpodobně správný, ale netestováno. |
| iDNES Reality | `api/v1/estates` | **Nízká** — endpoint i tvar odpovědi jsou odhad. Nejspíš bude potřeba přepsat. |
| Bezrealitky.cz | `api/v2/estates` | **Nízká** — endpoint je odhad. Bezrealitky podle všeho jedou na GraphQL, takže tenhle REST tvar nejspíš neexistuje. |
| Weby developerů | CSS selektory | **Nízká** — selektory (`[data-project-item]`, `.ekospolProperty`…) jsou vymyšlené, ne odečtené z HTML. |

Ověření musí proběhnout na stroji bez těchhle síťových omezení. Na to je
`npm run probe` — jeden dotaz na každý zdroj, nic se neukládá do databáze:

```bash
npm run probe          # všechny zdroje, Praha
npm run probe -- brno  # jiné město
```

U každého zdroje vypíše, jestli odpověděl, jestli sedí očekávaný tvar
a **která konkrétní pole chybí**. Surové odpovědi ukládá do `probe-output/`,
takže mapování se opravuje podle skutečných dat, ne podle dohadů:

```
✗ Bezrealitky (bezrealitky)
   odpověď není JSON (přišlo HTML — endpoint nejspíš neexistuje)
   surová odpověď: probe-output/bezrealitky.json
   oprav: backend/scrapers/bezrealitky.js → mapEstate()
```

Parsovací vrstva (`normalize.js`) je otestovaná a sdílená mezi zdroji,
takže se obvykle mění jen mapovací funkce, ne parsování.

Když ti `locality_region_id` u Sreality nesedí (Brno je nejistá konstanta),
jde přebít bez sahání do kódu:

```bash
SREALITY_REGION_BRNO=20 npm run probe -- brno
```

### Selhání je poznat

Scrapery nesmí selhat potichu. Nedostupný zdroj i zdroj, jehož tvar
odpovědi se změnil, končí popsanou chybou; noční běh vypíše souhrn
a skončí **nenulovým kódem**, když nepřinesl data ani jeden zdroj:

```
[CRON] Souhrn:
  ✓ Sreality
  ✗ Bezrealitky — 1 chyba
[CRON] ŽÁDNÝ ZDROJ NEPŘINESL DATA. Diagnostika: npm run probe
```

Snímek trhu se v takovém běhu přeskočí, aby prázdná dávka nepřepsala
poslední dobrá čísla.

Denní běh ve 2:00 zajišťuje `backend/cron.js`. Na serveru ho spusť jako
službu (`node backend/cron.js`) nebo nech plánovat systémovým cronem.

## Denní běh bez serveru (GitHub Actions)

`.github/workflows/scrape-reality.yml` stahuje data každý den ve 2:00 UTC
a výsledek commitne do `real-estate-scraper/data/`. Žádná databáze ani
hostitel k tomu nejsou potřeba — **historie commitů je zároveň historií trhu**.

Spustit se dá i ručně: záložka **Actions → Denní scrape nemovitostí →
Run workflow**. To je zatím jediný způsob, jak zdroje ověřit proti živým
webům, pokud nemáš po ruce stroj bez síťových omezení.

Běh vypisuje surové odpovědi zdrojů do logu (krok „Surové odpovědi zdrojů"),
takže podle nich jde opravit mapování — stejná data, jaká lokálně ukládá
`npm run probe` do `probe-output/`.

Za režim zápisu odpovídá `SCRAPER_SINK`:

| Hodnota | Kam se zapisuje |
|---|---|
| nenastaveno | PostgreSQL (`backend/scrapers/store.js`) |
| `json` | `data/listings.json` + `data/market-snapshots.json` |

Obě větve dělají stejný upsert: `first_seen_at` drží stáří inzerátu,
změna ceny se zapíše do historie a zlevnění uschová původní cenu. Kdyby se
rozešly, měl by graf vývoje cen jiný tvar podle toho, kde scraper běžel.

```bash
SCRAPER_SINK=json npm run scrape        # zápis do data/ místo do databáze
SCRAPER_KEEP_DAYS=60 npm run scrape     # jak dlouho držet stažené inzeráty (výchozí 30)
```

Inzerát, který se v běhu neobjeví a je starší než `SCRAPER_KEEP_DAYS`,
ze souboru vypadne — jinak by dataset donekonečna rostl o dávno prodané byty.

## Testy

```bash
npm test
```

Pokrývají parsování dat ze zdrojů (`backend/scrapers/normalize.js`),
vyhodnocovací logiku (`backend/lib/pricing.js`) a JSON zápis
(`backend/scrapers/json-sink.js`) — místa, kde se chyba projeví jako tiše
špatné číslo, ne jako pád.

## Struktura

```
backend/
├── server.js              Express API
├── lib/
│   ├── pricing.js         Cenový rating, výnos, stáří inzerátu
│   └── filters.js         Překlad filtrů na SQL
├── scrapers/
│   ├── normalize.js       Čisté parsovací funkce (testované)
│   ├── store.js           Ukládání + historie cen (databáze / JSON)
│   ├── json-sink.js       Zápis do data/*.json pro běh bez databáze
│   ├── sreality.js        Sreality přes JSON API
│   ├── idnes.js           iDNES Reality přes JSON API
│   ├── bezrealitky.js     Bezrealitky přes JSON API
│   └── developers.js      Weby developerů (Trigema, Central Group, Ekospol)
├── jobs/snapshot.js       Denní snímek mediánů trhu
├── db/
│   ├── migrations/        Schéma
│   └── seeds/             Demo data
└── cron.js                Denní plán

frontend/src/
├── pages/
│   ├── SearchPage.jsx     Sidebar + dlaždice / seznam / mapa
│   └── DetailPage.jsx     Detail, srovnání s trhem, kalkulačka
├── components/
│   ├── FilterSidebar.jsx
│   ├── HistogramSlider.jsx
│   ├── ListingCard.jsx
│   ├── PriceRatingBar.jsx
│   ├── MapComponent.jsx
│   ├── TrendChart.jsx
│   └── MortgageCalculator.jsx
└── lib/{api,format}.js
```

## API

| Endpoint | Co vrací |
|---|---|
| `GET /api/listings` | Seznam s filtry, řazením a stránkováním |
| `GET /api/listings/:id` | Detail včetně historie ceny a srovnání |
| `GET /api/facets` | Počty u voleb filtrů + histogramy pro slidery |
| `GET /api/map/:city` | Body na mapu (stejné filtry jako seznam) |
| `GET /api/stats/:city/medians` | Mediány trhu |
| `GET /api/stats/:city/trend` | Časová řada mediánů |
| `POST /api/calculator/mortgage` | Splátka, úroky, LTV |
| `POST /api/calculator/affordability` | DSTI a dostupnost |

## Co ještě chybí

- [ ] **Ověřit scrapery proti živým webům** — napsané jsou, otestované nejsou (viz tabulka výše)
- [ ] Další developeři (Vue Development, Skanska Reality, JRD…)
- [ ] Rozšíření na Brno a další krajská města
- [ ] Reálné referenční nájmy místo odhadu z kupních cen
- [ ] Hlídací pes — upozornění na nový nebo zlevněný inzerát
- [ ] Data z katastru pro realizované (ne nabídkové) ceny
- [ ] Deduplikace přes více zdrojů (stejná nemovitost od několika web…)
- [ ] Nasazení na produkční server
