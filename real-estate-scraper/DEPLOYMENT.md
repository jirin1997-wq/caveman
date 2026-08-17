# Nasazení Reality Scout

Průvodce nasazením na produkční server.

## Požadavky

- Node.js 18+
- PostgreSQL 14+
- 2+ GB RAM pro aplikaci
- Trvalé úložiště pro databázi

## Produkční setup

### 1. Databáze

```bash
# Vytvoř PostgreSQL uživatele a databázi
createuser realestate_prod --pwprompt --createdb
createdb realestate_prod -O realestate_prod
```

### 2. Aplikace

```bash
git clone https://github.com/jirin1997-wq/caveman.git caveman
cd caveman/real-estate-scraper

# Zkopíruj .env.example
cp .env.example .env.production

# Uprav .env.production
# NODE_ENV=production
# DATABASE_URL=postgresql://user:password@host/realestate_prod
# PORT=5000
# FRONTEND_URL=https://tvoje-domena.cz
# SCRAPER_CITIES=praha   (později rozšíř na: praha,brno)
# SCRAPER_TIMEOUT=30000
```

### 3. Build frontend

```bash
npm install
cd frontend && npm install && cd ..
npm run build
```

### 4. Migruj a nasej data

```bash
npm run db:migrate      # Vytvoří schéma
npm run db:seed         # Demo data pro začátek
```

### 5. Spuštění

**Backend (5000) + Cron:**
```bash
NODE_ENV=production npm run dev:backend &
node backend/cron.js &  # Spuštění cronu na pozadí
```

Nebo via systemd (doporučeno):

```ini
# /etc/systemd/system/reality-scout.service
[Unit]
Description=Reality Scout Backend
After=network.target postgresql.service

[Service]
Type=simple
User=nodeapp
WorkingDirectory=/opt/caveman/real-estate-scraper
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node backend/server.js
ExecStartPost=/usr/bin/node backend/cron.js

[Install]
WantedBy=multi-user.target
```

**Frontend (NGINX proxy):**

```nginx
server {
    listen 80;
    server_name reality.tvoje-domena.cz;
    
    # Frontend
    location / {
        root /opt/caveman/real-estate-scraper/frontend/dist;
        try_files $uri $uri/ /index.html;
    }
    
    # API proxy
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

## Monitorování

### Logy
```bash
journalctl -u reality-scout -f
tail -f /var/log/reality-scout.log
```

### Health check
```bash
curl http://localhost:5000/api/listings?city=praha | jq '.meta.total'
```

### Cron běh
Scraper se spouští denně v 02:00. Log v `backend/cron.js`.

## Údržba

### Aktualizace dat

**Manuálně:**
```bash
npm run scrape    # Stáhne všechny zdroje + snímek trhu
```

**Automaticky:**
Cron se spouští každý den v 02:00 (nastavitelné v `backend/cron.js`).

### Backup databáze

```bash
pg_dump realestate_prod > backup-$(date +%Y-%m-%d).sql
# Nebo komprimovaně:
pg_dump realestate_prod | gzip > backup-$(date +%Y-%m-%d).sql.gz
```

### Obnovení z backupu

```bash
psql realestate_prod < backup-2026-08-17.sql
```

## Rozšíření na Brno

1. Uprav `.env` na `SCRAPER_CITIES=praha,brno`
2. Spusť scraper: `npm run scrape`
3. Frontend si automaticky stáhne data pro obě města

## Známá omezení

- Scraper vyžaduje přístup k externe (v remote prostředí s proxy blokem nefunguje)
- Developer websites se parsují jako HTML — při změně designu se parsování rozbije (TODO: API)
- Deduplikace přes více zdrojů není implementovaná — stejná nemovitost se může zobrazit 2-4x

## Troubleshooting

**503 Databáze není dostupná:**
```bash
service postgresql status
psql -l  # Ověř, že DB existuje
```

**Scraper selhává:**
```bash
node backend/scrapers/sreality.js  # Testuj jednotlivě
```

**Frontend se nenačítá:**
```bash
npm run build  # Rebuild, zkontroluj build artefakty v dist/
```

## Contacts & Support

Repo: https://github.com/jirin1997-wq/caveman

## Changelog

### v1.0 (MVP)
- Sreality, iDNES, Bezrealitky, Developer websites
- Cenový rating (5 úrovní)
- Kalkulačka (hypotéka, dostupnost)
- Mapa + trend graf
- Filtry (cena, dispozice, lokalita, vybavenost)
- Demo data 475 nemovitostí (Praha)
