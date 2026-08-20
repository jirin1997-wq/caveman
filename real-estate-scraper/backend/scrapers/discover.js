/**
 * Průzkum zdrojů — hledá, kde na webu skutečně jsou inzeráty.
 *
 *   npm run discover
 *
 * Vzniklo poté, co první ostrý běh ukázal, že skoro všechny endpointy
 * v scraperech jsou vymyšlené: pět ze šesti zdrojů vrátilo 404. Ruční
 * dohadování cest znovu nemá smysl — tenhle skript se webu zeptá sám.
 *
 * Ke každé stránce vypíše:
 *   - kam se dotaz skutečně dostal (po přesměrováních) a co vrátil
 *   - odkazy, které vypadají jako výpis nemovitostí (kandidáti na URL)
 *   - API a GraphQL cesty zmíněné v inline skriptech
 *   - třídy prvků, které obsahují cenu v Kč (kandidáti na CSS selektory)
 *
 * Poslední bod je ten hlavní: selektor se nemá hádat, má se odečíst
 * z prvku, ve kterém cena reálně stojí.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

const TIMEOUT = Number(process.env.SCRAPER_TIMEOUT) || 30000;

// Bez věrohodné hlavičky část webů odpoví jinak než prohlížeči.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const TARGETS = [
  { key: 'sreality', url: 'https://www.sreality.cz/hledani/prodej/byty/praha' },
  { key: 'idnes', url: 'https://reality.idnes.cz/s/prodej/byty/praha/' },
  { key: 'bezrealitky', url: 'https://www.bezrealitky.cz/vyhledat?offerType=PRODEJ&estateType=BYT' },
  { key: 'trigema', url: 'https://www.trigema.cz/' },
  { key: 'centralGroup', url: 'https://www.centralgroup.cz/' },
  { key: 'ekospol', url: 'https://www.ekospol.cz/nemovitosti/praha/' }
];

const LISTING_WORDS = /nemovitost|byty|byt-|projekt|prodej|nabidka|nabídka|rezidence|vyhledat/i;
const PRICE = /\d[\d\s ]{5,}\s*(Kč|CZK)/;

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`
};

/** Otisk prvku pro čtení očima: `div.card.property#id`. */
function signature($, el) {
  const node = $(el);
  const tag = el.tagName || el.name || '?';
  const cls = (node.attr('class') || '').trim().split(/\s+/).filter(Boolean);
  const id = node.attr('id');
  const data = Object.keys(el.attribs || {}).filter((a) => a.startsWith('data-'));

  return (
    tag +
    cls.map((c) => `.${c}`).join('') +
    (id ? `#${id}` : '') +
    (data.length ? ` [${data.join(' ')}]` : '')
  );
}

/**
 * Najde prvky s cenou a vyleze po rodičích nahoru. Nejčastější otisk
 * v tom výstupu bývá karta jedné nemovitosti — přesně to, co potřebuje
 * `parse*()` jako selektor.
 */
export function priceContainers($) {
  const counts = new Map();

  $('*').each((_, el) => {
    const node = $(el);
    if (node.children().length > 0) return; // jen listy, ať se cena nepočítá vícekrát
    if (!PRICE.test(node.text())) return;

    let cur = el;
    for (let up = 0; up < 4 && cur; up += 1) {
      const sig = signature($, cur);
      counts.set(sig, (counts.get(sig) || 0) + 1);
      cur = cur.parent && cur.parent.tagName ? cur.parent : null;
    }
  });

  return [...counts.entries()]
    .filter(([sig]) => sig !== 'div' && sig !== 'span' && sig !== 'p')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
}

/** Cesty na API zmíněné přímo ve zdroji stránky. */
export function apiHints(html) {
  const found = new Set();
  for (const m of html.matchAll(/["'`](\/(?:api|graphql)[^"'`\s]{0,80})["'`]/g)) found.add(m[1]);
  for (const m of html.matchAll(/https?:\/\/[a-z0-9.-]*\/(?:api|graphql)[^"'`\s]{0,80}/gi)) {
    found.add(m[0]);
  }
  return [...found].slice(0, 15);
}

export function listingLinks($, base) {
  const found = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) return;
    if (!LISTING_WORDS.test(href)) return;
    try {
      found.add(new URL(href, base).href.split('?')[0]);
    } catch {
      /* relativní odkaz, který se nedá složit — přeskoč */
    }
  });
  return [...found].slice(0, 20);
}

async function inspect({ key, url }) {
  console.log(`\n${'='.repeat(70)}\n${C.b(key)}  ${C.dim(url)}`);

  let res;
  try {
    res = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      timeout: TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true
    });
  } catch (err) {
    console.log(`  ${C.bad('spojení selhalo')}: ${err.code || err.message}`);
    return;
  }

  const html = String(res.data);
  const $ = cheerio.load(html);
  const mark = res.status < 400 ? C.ok(res.status) : C.bad(res.status);

  console.log(`  HTTP ${mark}   ${html.length} B   „${$('title').text().trim().slice(0, 70)}"`);
  console.log(`  konečná URL: ${res.request?.res?.responseUrl || url}`);

  const prices = priceContainers($);
  if (prices.length) {
    console.log(`\n  ${C.b('prvky s cenou')} (počet výskytů — otisk):`);
    for (const [sig, n] of prices) console.log(`    ${String(n).padStart(4)}×  ${sig}`);
  } else {
    console.log(`\n  ${C.bad('na stránce není žádná cena v Kč')} — výpis se nejspíš dotahuje `
      + 'JavaScriptem, takže statické HTML nestačí a je potřeba najít API.');
  }

  const api = apiHints(html);
  if (api.length) {
    console.log(`\n  ${C.b('API cesty ve zdroji')}:`);
    for (const a of api) console.log(`    ${a}`);
  }

  const links = listingLinks($, url);
  if (links.length) {
    console.log(`\n  ${C.b('odkazy vypadající jako výpis')}:`);
    for (const l of links) console.log(`    ${l}`);
  }
}

export async function discoverAll() {
  console.log(C.b('\nPrůzkum zdrojů — kde na webu skutečně jsou inzeráty\n'));
  for (const target of TARGETS) {
    try {
      await inspect(target);
    } catch (err) {
      console.log(`  ${C.bad('průzkum spadl')}: ${err.message}`);
    }
  }
  console.log(`\n${'='.repeat(70)}\nHotovo. Podle otisků výše přepiš selektory a URL ve scraperech.\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  discoverAll().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
