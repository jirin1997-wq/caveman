import * as cheerio from 'cheerio';
import { parseBuildingType, parseCondition, parseAmenities } from './normalize.js';
import { unnbsp } from './extract.js';

/**
 * Čtení detailní stránky inzerátu.
 *
 * Výpis nese jen cenu, plochu, dispozici a adresu. Souřadnice, vybavenost,
 * konstrukce budovy a stav objektu jsou až na detailu — bez nich zůstane
 * mapa prázdná a půlka filtrů nemá co filtrovat.
 *
 * Parser je schválně jeden pro všechny zdroje a řídí se názvy parametrů,
 * ne značkováním: weby je sázejí jednou do <dl>, jindy do tabulky nebo do
 * seznamu, ale popisky jsou napříč trhem stejné („Konstrukce budovy",
 * „Stav", „Podlaží"). Na názvy se dá spolehnout víc než na třídy.
 */

const tidy = (text) => unnbsp(text).replace(/\s+/g, ' ').trim();

/**
 * Tabulka parametrů jako mapa `název → hodnota`. Klíče jsou bez diakritiky
 * a malými písmeny, ať se na ně dá odkazovat nezávisle na zápisu zdroje.
 */
export function paramMap($) {
  const map = new Map();
  const add = (key, value) => {
    const name = tidy(key).replace(/:$/, '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    const text = tidy(value);
    if (name && text && text.length < 120 && !map.has(name)) map.set(name, text);
  };

  $('dl').each((_, dl) => {
    const values = $(dl).find('dd');
    $(dl).find('dt').each((i, dt) => add($(dt).text(), $(values[i]).text()));
  });

  $('tr').each((_, tr) => {
    const cells = $(tr).find('th, td');
    if (cells.length === 2) add($(cells[0]).text(), $(cells[1]).text());
  });

  // Weby, které parametry sázejí do seznamu („Podlaží: 3. NP").
  $('li, p, span, div').each((_, el) => {
    const node = $(el);
    if (node.children().length > 1) return;
    const match = tidy(node.text()).match(/^([^:]{2,30}):\s*(.{1,60})$/);
    if (match && !/^https?/.test(match[2])) add(match[1], match[2]);
  });

  return map;
}

/**
 * Souřadnice ze zdroje stránky.
 *
 * Desetinná část je povinná — bez ní by se za zeměpisnou šířku bralo
 * kdejaké celé číslo v okolním JSONu. Rozsah odpovídá Česku, takže se
 * nepoplete se souřadnicemi z map v patičce nebo z cizí nabídky.
 */
export function geoFromHtml(html) {
  const text = String(html || '');
  const pick = (names) => {
    for (const pattern of [
      new RegExp(`"(?:${names})"\\s*:\\s*"?(-?\\d{1,3}\\.\\d{3,})`, 'i'),
      new RegExp(`data-(?:${names})="(-?\\d{1,3}\\.\\d{3,})"`, 'i')
    ]) {
      const match = text.match(pattern);
      if (match) return Number(match[1]);
    }
    return null;
  };

  const lat = pick('lat|latitude');
  const lng = pick('lng|lon|longitude');

  const inCzechia = lat >= 48.5 && lat <= 51.1 && lng >= 12 && lng <= 18.9;
  return inCzechia ? { lat, lng } : { lat: null, lng: null };
}

/** Podlaží jako číslo: „11. podlaží z 12" → 11, „3. NP" → 3. */
export function floorFromText(text) {
  const match = unnbsp(text).match(/(-?\d{1,2})\s*\.\s*(?:podlaz|podlaž|NP|patro)/i);
  return match ? Number(match[1]) : null;
}

const VALUE_OF = (map, ...names) => names.map((n) => map.get(n)).filter(Boolean);

/**
 * Vytáhne z detailu to, co ve výpisu chybí.
 * Chybějící údaj není chyba — zdroje se v tom, co uvádějí, liší.
 */
export function parseDetail(html) {
  const $ = cheerio.load(html);
  const params = paramMap($);
  const { lat, lng } = geoFromHtml(html);

  // Vybavenost se hledá jen v hlavním obsahu. Celá stránka nese i blok
  // „Podobné nabídky", ze kterého by se přitáhl cizí balkón nebo výtah.
  const main = $('main, article, [role="main"]').first();
  const scope = main.length ? main : $('body');
  scope.find('script, style').remove();

  // Popisky se mezi zdroji liší v drobnostech: Bezrealitky píšou „Stav",
  // iDNES „Stav bytu". Proto se u každého údaje zkouší víc názvů.
  const labels = [
    ...VALUE_OF(params, 'konstrukce budovy', 'stavba', 'typ budovy'),
    ...VALUE_OF(params, 'stav', 'stav bytu', 'stav objektu', 'stav nemovitosti')
  ];

  return {
    latitude: lat,
    longitude: lng,
    building_type: parseBuildingType(labels),
    condition: parseCondition(labels),
    floor: floorFromText(params.get('podlazi') || params.get('patro') || ''),
    amenities: parseAmenities(tidy(scope.text()).slice(0, 8000)),
    energy_rating: params.get('penb') || params.get('energeticka narocnost') || null,
    ownership: params.get('vlastnictvi') || null,
    heating: params.get('vytapeni') || null,
    furnishing: params.get('vybaveni') || params.get('vybaveno') || null
  };
}
