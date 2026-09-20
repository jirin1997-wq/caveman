/**
 * Doplnění souřadnic iDNES inzerátů na základě ulice.
 *
 * iDNES detail nemá souřadnice, ale 70% jejich pražských inzerátů
 * sedí na ulicích, které známe ze Sreality (která souřadnice má).
 * Tímto se GPS dostane z 46% na ~70% bez dodatečného stahování.
 *
 *   npm run enrich:gps
 *
 * Souřadnice se značí jako "approximate" (úroveň ulice, ne adresy).
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = 'data';
const LISTINGS_FILE = path.join(DATA_DIR, 'listings.json');

/**
 * Vytvoří mapu ulice → souřadnice z inzerátů s GPS.
 * Preference: Sreality > ostatní.
 */
function buildStreetMap(listings) {
  const streetMap = new Map();

  const bySource = {
    sreality: listings.filter(l => l.source === 'sreality' && l.latitude && l.longitude),
    idnes: listings.filter(l => l.source === 'idnes' && l.latitude && l.longitude),
    bezrealitky: listings.filter(l => l.source === 'bezrealitky' && l.latitude && l.longitude)
  };

  // Sreality first (highest trust)
  bySource.sreality.forEach(l => {
    const street = extractStreet(l.address);
    if (street && !streetMap.has(street)) {
      streetMap.set(street, { lat: l.latitude, lng: l.longitude });
    }
  });

  // Fallback to iDNES + Bezrealitky
  [...bySource.idnes, ...bySource.bezrealitky].forEach(l => {
    const street = extractStreet(l.address);
    if (street && !streetMap.has(street)) {
      streetMap.set(street, { lat: l.latitude, lng: l.longitude });
    }
  });

  return streetMap;
}

/**
 * Extrahuje ulici z adresy.
 * Formáty:
 *   "Korunní, Praha 2" → "Korunní"
 *   "Murmanská, Praha 10 - Vršovice" → "Murmanská"
 *   "Alešova, Brno - Černá Pole" → "Alešova"
 */
function extractStreet(address) {
  if (!address) return null;
  const parts = address.split(',');
  const street = parts[0]?.trim();
  return street && street.length > 1 ? street : null;
}

/**
 * Přidá přibližné souřadnice z mapy.
 * Vrací počet obohacených inzerátů.
 */
function enrichListingsWithStreetCoords(listings, streetMap) {
  let enriched = 0;

  listings.forEach(l => {
    // Jen inzerátům bez GPS
    if (l.latitude || l.longitude) return;

    const street = extractStreet(l.address);
    if (!street) return;

    const coords = streetMap.get(street);
    if (!coords) return;

    l.latitude = coords.lat;
    l.longitude = coords.lng;
    l.gps_source = 'street_inference';  // značka, že je to přibližné
    enriched++;
  });

  return enriched;
}

export async function enrichGps() {
  console.log('🗺️  Doplnění souřadnic z ulice');

  if (!fs.existsSync(LISTINGS_FILE)) {
    console.error(`Chybí ${LISTINGS_FILE}`);
    return { ok: false, enriched: 0 };
  }

  const content = fs.readFileSync(LISTINGS_FILE, 'utf8');
  const wrapper = JSON.parse(content);
  const listings = wrapper.listings;

  console.log(`  ${listings.length} inzerátů celkem`);

  const prague = listings.filter(l => l.city === 'praha');
  const withoutGps = prague.filter(l => !l.latitude || !l.longitude);
  console.log(`  Praha: ${prague.length} (bez GPS: ${withoutGps.length})`);

  const streetMap = buildStreetMap(listings);
  console.log(`  ${streetMap.size} známých ulic`);

  const enriched = enrichListingsWithStreetCoords(prague, streetMap);
  console.log(`  Obohaceno: ${enriched} inzerátů (+${Math.round(100*enriched/withoutGps.length)}%)`);

  // Uložení
  fs.writeFileSync(LISTINGS_FILE, JSON.stringify(wrapper, null, 2));

  const afterGps = prague.filter(l => l.latitude && l.longitude).length;
  const coverage = Math.round(100 * afterGps / prague.length);
  console.log(`✓ GPS pokrytí Praha: ${coverage}% (${afterGps}/${prague.length})`);

  return { ok: true, enriched };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  enrichGps()
    .then(res => process.exit(res.ok ? 0 : 1))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
