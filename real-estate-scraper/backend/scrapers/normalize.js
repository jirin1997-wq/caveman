/**
 * Čisté parsovací funkce pro data ze zdrojů.
 * Bez I/O, takže jdou testovat samostatně — parsování je nejkřehčí
 * část scraperu a láme se pokaždé, když zdroj změní formát.
 */

import { DISPOSITIONS } from '../lib/filters.js';

/** "Prodej bytu 3+kk 75 m²" → "3+kk". Vrací null, když dispozice chybí. */
export function parseDisposition(text) {
  if (!text) return null;
  const match = String(text).match(/(\d)\s*\+\s*(kk|\d)/i);
  if (!match) return /atypick/i.test(text) ? 'atypicky' : null;

  const code = `${match[1]}+${match[2].toLowerCase()}`;
  return DISPOSITIONS.includes(code) ? code : null;
}

/**
 * "75 m²" / "75 m2" / "1 250 m²" → 75.
 *
 * Dvě podmínky, obě kvůli číselným dispozicím („Prodej bytu 3+1 68 m²"):
 *   - mezera je oddělovač tisíců jen před skupinou přesně tří číslic,
 *     jinak by z „3+1 68 m²" vyšlo 168 m²,
 *   - číslo nesmí navazovat na `+` nebo na jinou číslici, jinak by
 *     z „2+1 105 m²" vyšlo 1105 m².
 * Obojí by tiše několikanásobně posunulo cenu za metr, a to u velké části
 * nabídky — číselné dispozice jsou běžné.
 */
export function parseArea(text) {
  if (!text) return null;
  const normalized = String(text).replace(/ /g, ' ');
  const match = normalized.match(/(?<![+\d])(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)\s*m/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** "11 700 000 Kč" → 11700000. Textové ceny ("Info o ceně") → null. */
export function parsePrice(value) {
  if (typeof value === 'number') return value > 0 ? value : null;
  if (!value) return null;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return null;
  const price = parseInt(digits, 10);
  return price > 0 ? price : null;
}

/**
 * "Murmanská, Praha 10 - Vršovice" → { district: 'Praha 10', neighborhood: 'Vršovice' }
 * Zvládne i brněnský tvar "Veveří, Brno-střed".
 */
export function parseLocality(text) {
  if (!text) return { district: null, neighborhood: null };
  const clean = String(text).trim();

  const praha = clean.match(/(Praha\s+\d+)(?:\s*[-–]\s*([^,]+))?/i);
  if (praha) {
    return {
      district: praha[1].replace(/\s+/g, ' '),
      neighborhood: praha[2]?.trim() || null
    };
  }

  const brno = clean.match(/(Brno[-\s][^\s,]+)/i);
  if (brno) {
    const parts = clean.split(',').map((p) => p.trim());
    return { district: brno[1], neighborhood: parts[0] !== brno[1] ? parts[0] : null };
  }

  const parts = clean.split(',').map((p) => p.trim()).filter(Boolean);
  return { district: parts[parts.length - 1] || null, neighborhood: parts[0] || null };
}

/** Sreality kóduje stav a materiál v textových štítcích inzerátu. */
export function parseBuildingType(labels = []) {
  const text = labels.join(' ').toLowerCase();
  if (text.includes('cihl')) return 'cihlova';
  if (text.includes('panel')) return 'panelova';
  if (text.includes('smíšen') || text.includes('smisen')) return 'smisena';
  return null;
}

export function parseCondition(labels = []) {
  const text = labels.join(' ').toLowerCase();
  if (text.includes('novostavba')) return 'novostavba';
  if (text.includes('rekonstrukc')) return 'k_rekonstrukci';
  if (text.includes('dobrý') || text.includes('dobry') || text.includes('velmi dobr')) return 'dobry';
  return null;
}

// Vzory míří na kmen slova, ne na 1. pád — inzeráty píšou
// "s lodžií", "s terasou", "po rekonstrukci" a podobně.
const AMENITY_PATTERNS = [
  ['balkon', /balk[oó]n/i],
  ['terasa', /teras/i],
  ['lodzie', /lodži|lodzi/i],
  ['sklep', /sklep/i],
  ['vytah', /v[yý]tah/i],
  ['garaz', /gar[aá][zž]/i],
  ['parkovani', /parkov/i]
];

/** Vytáhne vybavenost z libovolného textu inzerátu (štítky + popis). */
export function parseAmenities(text) {
  if (!text) return [];
  const haystack = Array.isArray(text) ? text.join(' ') : String(text);
  return AMENITY_PATTERNS.filter(([, pattern]) => pattern.test(haystack)).map(([key]) => key);
}

/** Cena za m² — počítá se, nikdy se nepřebírá ze zdroje. */
export function pricePerM2(price, sizeM2) {
  if (!price || !sizeM2) return null;
  return Math.round(price / sizeM2);
}

/**
 * Poskládá znormalizovaný záznam připravený k uložení.
 * Vrací null, když chybí povinná pole (URL, cena) — takový inzerát
 * nemá smysl ukládat, jen by kazil mediány.
 */
export function buildListing(raw) {
  const price = parsePrice(raw.price);
  if (!raw.url || !price) return null;

  const sizeM2 = raw.sizeM2 ?? parseArea(raw.name);
  const disposition = raw.disposition ?? parseDisposition(raw.name);
  const { district, neighborhood } = parseLocality(raw.locality);
  const labels = raw.labels || [];

  return {
    url: raw.url,
    source: raw.source,
    source_name: raw.sourceName || null,
    listing_type: raw.listingType || 'byt',
    title: raw.name || `${disposition || 'Nemovitost'}${sizeM2 ? `, ${sizeM2} m²` : ''}`,
    price,
    price_per_m2: pricePerM2(price, sizeM2),
    size_m2: sizeM2,
    rooms: disposition ? parseInt(disposition, 10) || null : null,
    disposition,
    address: raw.locality || district || '',
    district,
    neighborhood,
    city: raw.city,
    latitude: raw.lat ?? null,
    longitude: raw.lng ?? null,
    building_type: parseBuildingType(labels),
    condition: parseCondition(labels),
    amenities: JSON.stringify(parseAmenities([...labels, raw.description || ''])),
    completion_year: raw.completionYear ?? null,
    description: raw.description || null,
    photos: JSON.stringify(raw.photos || [])
  };
}
