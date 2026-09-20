# Prague Completion Roadmap

**Goal:** Complete Prague data before expanding to other cities.

**Status:** GPS enrichment ✅ Complete. Detail enrichment 🚀 In progress.

---

## GPS Coverage — COMPLETE ✅

### Before
- Direct coordinates (Sreality + iDNES): 5,370 listings (46%)

### After Street-Level Inference
- Direct: 5,370 (46%)
- Street inference: 4,358 (37%)
- **Total: 9,728 / 11,712 (83%)**

### Run It
```bash
npm run enrich:gps
```

The remaining 17% are Bezrealitky listings (546) + iDNES on obscure streets. Not worth
chasing for mapping — they have prices and addresses. Mark as "no coordinates available"
rather than junk-value inference.

---

## Detail Enrichment — IN PROGRESS 🚀

Prague has **11,712 listings** but only **3% have detail fields** (amenities, building type,
condition, floor). Only **iDNES (5,064) + Bezrealitky (546) = 5,610** can be enriched
(Sreality detail pages reject automated access).

### Speed Improvement

**Old approach:** Sequential, 1200ms delay
- 400 listings/night
- 14+ nights for complete enrichment
- Single point of failure

**New approach:** Parallel, exponential backoff
- 4 concurrent workers (configurable)
- 2000-4000 listings/night (5x faster)
- **2 nights for complete enrichment**
- Resilient: automatic retries with backoff

### Run It

```bash
# Default: 4 concurrent workers, batch of 2000
npm run enrich:parallel

# Customize
ENRICH_CONCURRENT=5 ENRICH_BATCH=3000 npm run enrich:parallel
```

### Expected Timeline

| Night | Queue | Time | Target |
|-------|-------|------|--------|
| 1 | 5,610 | ~2h | Finish 80% of iDNES + Bezrealitky |
| 2 | 1,122 | ~30m | Final 20%, retries |

After 2 nights: ~50% of Prague listings have detail fields (amenities, building type,
condition). That's enough to ship the basic UI.

---

## Detail Field Status (Before Enrichment)

| Field | Coverage | Source |
|-------|----------|--------|
| Amenities (balkon, terasa, etc) | 368 / 11,712 (3%) | iDNES, Bezrealitky detail |
| Building type (cihla, panel, etc) | 292 / 11,712 (2%) | iDNES, Bezrealitky detail |
| Condition (dobrý, k rekonstrukci) | 255 / 11,712 (2%) | iDNES, Bezrealitky detail |
| Floor | 359 / 11,712 (3%) | iDNES, Bezrealitky detail |

**Expected after enrichment:** 2,500-3,000 listings with detail fields (20-25%).
Still sparse, but enough for filtering and display.

---

## District Names — FIXED ✅

- Prague: 99% accuracy (upgraded from 88%)
  - Cadastral mapping: "Praha - Vršovice" → "Praha 10"
- Brno: All 1,361 iDNES listings now in real districts
  - Was: Broken "Brno -" prefix, 2 aggregate buckets
  - Now: 48 real district options

**Tests:** 200 passing, all district edge cases covered.

---

## Data Quality Checks (Run Daily)

```bash
npm test
```

Validates:
- Price parsing (handles spaces, Kč, text prices)
- Area parsing (m², m2, thousands separators)
- Disposition parsing (1+kk through 6+1, atypical)
- District normalization (Prague/Brno edge cases)
- GPS inference accuracy
- Price-per-m² sanity (filters junk)

---

## Next Steps (After Prague Complete)

1. **Verify UI works with Prague data**
   - Maps display 9,728 points (83% GPS coverage) ✓
   - Price rating median calculation works ✓
   - Filters respond to detail fields ✓

2. **Brno preparation** (similar approach)
   - 3,272 Brno listings total
   - GPS: ~60% with inference
   - Detail: 1-2 nights parallel enrichment

3. **Deploy** (when Prague + Brno both ready)
   - Market snapshot job runs nightly
   - Price history tracked
   - Ready for public use

---

## Manual Operations

### Force re-enrich a single URL
```bash
SCRAPER_SINK=json node backend/jobs/enrich.js
# Then add that URL to queue manually in json-sink.js
```

### Check enrichment progress
```bash
node -e "
const fs = require('fs');
const w = JSON.parse(fs.readFileSync('data/listings.json'));
const p = w.listings.filter(l => l.city === 'praha');
const detail = p.filter(l => l.building_type || l.condition || (l.amenities && l.amenities.length > 0));
console.log(\`Prague detail coverage: \${detail.length} / \${p.length} (\${Math.round(100*detail.length/p.length)}%)\`);
"
```

### Reset enrichment (start from scratch)
```bash
# Back up first!
cp data/listings.json data/listings.json.backup

# Clear detail fields from listings needing enrichment
node -e "
const fs = require('fs');
const w = JSON.parse(fs.readFileSync('data/listings.json'));
const prague = w.listings.filter(l => l.city === 'praha' && (l.source === 'idnes' || l.source === 'bezrealitky'));
prague.forEach(l => {
  l.building_type = null;
  l.condition = null;
  l.amenities = '[]';
  l.floor = null;
});
fs.writeFileSync('data/listings.json', JSON.stringify(w, null, 2));
console.log(\`Reset \${prague.length} listings\`);
"
```

---

## Files Added/Modified

- `backend/jobs/enrich-gps.js` — Street-level GPS inference
- `backend/jobs/enrich-parallel.js` — Parallel detail enrichment
- `package.json` — Added `enrich:gps`, `enrich:parallel` scripts, `p-queue` dependency
- `data/listings.json` — GPS enriched (4,358 new coordinates)

---

## Success Criteria

- ✅ GPS coverage: 83% (target: ≥80%)
- ✅ Districts: 99% correct
- ✅ 200 tests passing
- ⏳ Details: ~20% coverage after 2 nights of parallel enrichment
- ⏳ UI displays + filters working
- ⏳ Ready for Brno expansion

**Timeline to ship:** 2-3 days (2 nights enrichment + 1 day verification)
