# 🏠 Reality Scout

Real estate scraper & analyzer pro české nemovitosti (Praha + Brno). Denně stahuje inzeráty, sleduje ceny, vyhodnocuje dispozice.

## Co umí

- 🔍 **Scraper**: Automaticky stahuje inzeráty z Sreality, iDNES, developerů
- 📊 **Historie cen**: Sleduje vývoj cen v čase (graf)
- 💰 **Cena/m²**: Počítá a filtruje cenu za metr čtvereční
- 🏢 **Dispozice**: Filtruje podle počtu pokojů, velikosti, lokality
- 🔔 **Denní updaty**: Cron job spouští scraper každou noc v 2:00 AM
- 🌐 **Web app**: Interaktivní rozhraní na procházení a filtrování

## Tech Stack

- **Backend**: Node.js + Express + PostgreSQL
- **Scraper**: Puppeteer (JS weby) + Cheerio (HTML parse)
- **Frontend**: React + Vite + Tailwind CSS
- **Databáze**: PostgreSQL + Knex migrations
- **Deploy**: Docker Compose

## Rychlý start

### 1. Příprava
```bash
cd real-estate-scraper
cp .env.example .env
npm install
cd frontend && npm install && cd ..
```

### 2. Spusť databázi
```bash
npm run docker:up
sleep 5
npm run db:migrate
```

### 3. Spusť backend + frontend dev servery
```bash
npm run dev
```

- Backend: `http://localhost:5000`
- Frontend: `http://localhost:3000`

### 4. Ruční scrape (test)
```bash
npm run scrape:sreality
```

## Struktura

```
backend/
├── server.js          # Express API
├── scrapers/
│   ├── sreality.js    # Sreality scraper
│   ├── idnes.js       # (TODO) iDNES scraper
│   └── developers.js  # (TODO) Developer weby
├── db/
│   ├── knexfile.js
│   └── migrations/    # DB schema
└── cron.js            # Denní scheduling

frontend/
├── src/
│   ├── App.jsx        # Main app
│   ├── pages/
│   │   ├── SearchPage.jsx  # Seznam + filtry
│   │   └── DetailPage.jsx  # Detail inzerátu + graf
│   └── index.css      # Tailwind
└── vite.config.js
```

## API Endpointy

- `GET /api/health` — Health check
- `GET /api/listings?city=praha&minPrice=1000000&maxPrice=5000000` — Seznam s filtry
- `GET /api/listings/:id` — Detail inzerátu + ceny
- `GET /api/listings/:id/price-trend` — Graf ceny (JSON)

## Příští kroky (Fáze 2+)

- [ ] iDNES reality scraper
- [ ] Developer weby (Orco, Trigema, Ekospol…)
- [ ] Detekce podezřelých cen (ML)
- [ ] Notifikace na pokles ceny
- [ ] Mobile app / PWA
- [ ] Deploy na VPS

## Notes

- Scraper nyní parsuje jen Sreality (ostatní TODO)
- Databáze resetuje pomocí `docker-compose down -v`
- Frontend proxy předává API požadavky na backend (vite.config.js)
