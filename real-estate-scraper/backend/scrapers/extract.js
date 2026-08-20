/**
 * Čtení inzerátů z HTML výpisu — společné pro Sreality, iDNES i Bezrealitky.
 *
 * Všechny tři portály posílají výpis v HTML, ne přes veřejné API. Zásadní
 * je nespoléhat na názvy tříd: Sreality generují emotion hashe (`css-abbpa2`)
 * a Bezrealitky CSS moduly (`PropertyCard_propertyCard__moO_5`) — obojí se
 * mění při každém nasazení jejich webu. Scraper postavený na nich vydrží
 * týdny, ne měsíce.
 *
 * Proto se tady vychází z toho, co je na stránce významové: odkaz na detail
 * inzerátu a text s cenou v korunách.
 */

import { parseArea, parseDisposition } from './normalize.js';

/** Nezlomitelné mezery z českých čísel — jinak by regulární výrazy míjely. */
export const unnbsp = (text) => String(text || '').replace(/[  ]/g, ' ');

/**
 * Cena v korunách z libovolného textu.
 *
 * Záporný lookahead vynechává cenu za metr: Bezrealitky píšou
 * „6 400 000 Kč(112 281 Kč / m²)" a bez něj by scraper bral druhé číslo.
 * Cena za m² se počítá z ceny a plochy, nikdy se nepřebírá ze zdroje.
 */
export function priceFromText(text) {
  const match = unnbsp(text).match(/(\d[\d ]{4,})\s*Kč(?!\s*\/\s*m)/);
  if (!match) return null;
  const value = parseInt(match[1].replace(/\s/g, ''), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Plocha v m² z jednoho kusu textu. */
export const areaFromText = (text) => parseArea(unnbsp(text));

/** Dispozice (3+kk, 2+1…) z jednoho kusu textu. */
export const dispositionFromText = (text) => parseDisposition(unnbsp(text));

/**
 * Texty listových prvků karty, v pořadí, v jakém stojí na stránce.
 *
 * Čtení musí jít po prvcích, ne ze slepeného textu celé karty. Bezrealitky
 * mají dispozici a plochu ve dvou sousedních <li> („3+1", „57 m²") a
 * `card.text()` z toho udělá „3+157 m²" — plocha by pak vyšla 157 místo 57
 * a cena za metr by byla u každého jejich inzerátu špatně.
 */
export function leafTexts($, card) {
  const texts = [];
  card.find('*').each((_, el) => {
    const node = $(el);
    if (node.children().length > 0) return;
    const text = unnbsp(node.text()).trim();
    if (text) texts.push(text);
  });
  return texts;
}

/** Plocha z karty — první prvek, ze kterého se dá přečíst. */
export function areaFromCard($, card) {
  for (const text of leafTexts($, card)) {
    const area = areaFromText(text);
    if (area) return area;
  }
  return null;
}

/** Dispozice z karty — první prvek, ze kterého se dá přečíst. */
export function dispositionFromCard($, card) {
  for (const text of leafTexts($, card)) {
    const disposition = dispositionFromText(text);
    if (disposition) return disposition;
  }
  return null;
}

/**
 * Adresa z textu karty — hledá řádek, na kterém stojí město.
 * Karty mívají adresu jako samostatný odstavec („Odkolkova, Praha - Vysočany"),
 * takže stačí najít ten, který zmiňuje Prahu nebo Brno a není nadpisem s cenou.
 */
export function localityFromCard($, card) {
  const candidates = [];
  card.find('p, span, div, h2, h3, li').each((_, el) => {
    const node = $(el);
    if (node.children().length > 2) return;
    const text = unnbsp(node.text()).trim();
    if (!/\b(Praha|Brno)\b/i.test(text)) return;
    if (/Kč/.test(text)) return;
    if (text.length > 120) return;
    candidates.push(text);
  });
  // Nejkratší kandidát bývá samotná adresa, delší nabalují okolní text.
  return candidates.sort((a, b) => a.length - b.length)[0] || null;
}

/**
 * Najde karty inzerátů podle odkazů na detail.
 *
 * Od odkazu se leze nahoru, dokud se nenajde prvek, který obsahuje cenu
 * a zároveň právě jeden takový odkaz. Ta druhá podmínka je důležitá: bez ní
 * by se u některých rozvržení vylezlo až na celý seznam a všechny inzeráty
 * by pak dostaly cenu toho prvního.
 */
export function cardsFromLinks($, hrefPattern, { maxDepth = 8 } = {}) {
  const seen = new Set();
  const cards = [];

  const linkCount = (node) =>
    node.find('a[href]').filter((_, a) => hrefPattern.test($(a).attr('href') || '')).length +
    (node.is('a') && hrefPattern.test(node.attr('href') || '') ? 1 : 0);

  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href');
    if (!href || !hrefPattern.test(href) || seen.has(href)) return;

    let node = $(anchor);
    let found = false;

    for (let up = 0; up < maxDepth; up += 1) {
      if (priceFromText(node.text()) && linkCount(node) <= 1) {
        found = true;
        break;
      }
      const parent = node.parent();
      if (!parent.length || parent.is('body') || parent.is('html')) break;
      node = parent;
    }

    if (!found) return;
    seen.add(href);
    cards.push({ href, card: node });
  });

  return cards;
}

/**
 * Sesbírá z karty vše, co jde přečíst z výpisu.
 * Chybějící plocha nebo dispozice není chyba — doplní se z názvu inzerátu
 * v `buildListing()`, případně zůstane prázdná.
 */
export function readCard($, card, { href, title, price, locality } = {}) {
  return {
    url: href,
    name: title ?? null,
    price: price ?? priceFromText(card.text()),
    sizeM2: areaFromCard($, card),
    disposition: dispositionFromCard($, card),
    locality: locality ?? localityFromCard($, card),
    photos: [card.find('img[src]').first().attr('src')].filter(Boolean)
  };
}

/** Města, která projekt sleduje. Zbytek republiky se zahazuje. */
const CITY_PATTERNS = { praha: /\bPraha\b/i, brno: /\bBrno\b/i };

/**
 * Pozná město z adresy. Některé zdroje (Bezrealitky) vracejí výpis za celou
 * republiku, takže filtrovat se musí až tady, ne dotazem.
 */
export function cityFromLocality(locality, allowed = ['praha', 'brno']) {
  const text = unnbsp(locality);
  return allowed.find((city) => CITY_PATTERNS[city]?.test(text)) || null;
}
