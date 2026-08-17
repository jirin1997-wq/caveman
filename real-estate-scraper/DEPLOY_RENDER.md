# Nasazení na Render.com (1 klik)

Nejjednodušší cesta do produkce. Free tier má vše co potřebujeme.

## Kroky

### 1. Připrav si účet na Render.com
- Jdi na https://render.com
- Klikni "Sign Up" (GitHub login = nejrychlejší)
- Autorizuj si GitHub

### 2. Nový projekt
- Dashboard → "New +" → "Blueprint"
- Vyberi "Connect a repository"
- Autorizuj GitHub
- Vyber repo: `jirin1997-wq/caveman`

### 3. Deploy
- Render si přečte `render.yaml` z root složky projektu
- Klikni "Deploy"
- Čeká ~3-5 minut

**Hotovo!** Aplikace běží na `https://reality-scout-web-xxxxx.onrender.com`.

## Co se vytvoří

- **API backend** (reality-scout-api) — Node.js, port 5000
- **Frontend** (reality-scout-web) — Static hosting
- **Database** (realestate-db) — PostgreSQL 14
- **Cron job** — Daily scraper v 02:00 UTC

## První start

Aplikace se spustí s demo daty. Aby se scrapovaly reálná data:

1. Naviň `SCRAPER_CITIES=praha` → `praha,brno` (pokud chceš Brno)
2. Manuálně spusť scraper v Render dashboaru:
   - Jdi na "Services" → "reality-scout-api"
   - "Console" → spusť:
   ```bash
   npm run scrape
   ```

## Monitoring

### Logy
- Dashboard → Services → vyberi službu → "Logs"

### Health check
```bash
curl https://reality-scout-api-xxxxx.onrender.com/api/listings?city=praha | head -c 200
```

### Databáze
- Dashboard → Databases → realestate-db
- "Connect" → credentials pro psql

## Omezení free tier

- Cron job se spouští jen na paid planu — na free se spouští ručně
- Databáze se resetuje po 30 dnech bez aktivity (demo data se znovu nasemenují)
- Max 0.5 GB RAM na service

**Upgrade na paid:** klikni na service → vybri "Advanced" → "Upgrade"

## Problém: Scraper selhává

Render má proxy omezení — scrapování z externích webů nemusí fungovat.

**Řešení:**
1. Zvaž vlastní server s neomezením (DigitalOcean, Hetzner, atd.)
2. Scrapery jsou připravené — stačí běžný Linux server
3. Render se hodí pro frontend+API, scraper běží jinde

## Další platformy

Pokud se ti Render nelíbí:

### Railway.app
```bash
railway link
railway up
```

### DigitalOcean App Platform
Vytvoř Droplet (Ubuntu 22.04), pak:
```bash
git clone ...
npm install
npm run db:migrate
npm run db:seed
npm run dev &  # nebo systemd
```

## Git push = auto-deploy

Jakmile pusheš na main ← `claude/real-estate-scraper-v3ftkb`, Render se automaticky deployuje.

```bash
git push origin claude/real-estate-scraper-v3ftkb:main
```

(Pokud máš main na main, ne na dev branchi.)

## Troubleshooting

**Build fails:**
- Zkontroluj `render.yaml` syntax
- Zkontroluj package.json (`npm run build` musí fungovat lokálně)

**API 503:**
- Databáze se startuje — čekej 1-2 minuty
- Zkontroluj Logs v Render dashboaru

**Frontend nenačítá:**
- Zkontroluj VITE_API_URL — musí být URL na backend

---

**Potřebuješ pomoc?** Zkontroluj Render docs: https://render.com/docs
