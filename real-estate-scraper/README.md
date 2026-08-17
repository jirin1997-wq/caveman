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
npm run scrape          # scrape + snímek trhu (co dělá i noční cron)
npm run scrape:sreality # jen Sreality
npm run snapshot        # jen přepočet snímku trhu
```

Denní běh ve 2:00 zajišťuje `backend/cron.js`. Na serveru ho spusť jako
službu (`node backend/cron.js`) nebo nech plánovat systémovým cronem.

## Testy

```bash
npm test
```

Pokrývají parsování dat ze zdrojů (`backend/scrapers/normalize.js`) a
vyhodnocovací logiku (`backend/lib/pricing.js`) — dvě místa, kde se chyba
projeví jako tiše špatné číslo, ne jako pád.

## Struktura

```
backend/
├── server.js              Express API
├── lib/
│   ├── pricing.js         Cenový rating, výnos, stáří inzerátu
│   └── filters.js         Překlad filtrů na SQL
├── scrapers/
│   ├── normalize.js       Čisté parsovací funkce (testované)
│   ├── store.js           Ukládání + historie cen
│   └── sreality.js        Sreality přes veřejné JSON API
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

- [ ] iDNES reality, Bezrealitky
- [ ] Weby developerů (Trigema, Central Group, Ekospol…)
- [ ] Reálné referenční nájmy místo odhadu z kupních cen
- [ ] Hlídací pes — upozornění na nový nebo zlevněný inzerát
- [ ] Data z katastru pro realizované (ne nabídkové) ceny
- [ ] Nasazení
