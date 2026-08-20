/**
 * Společná HTTP vrstva scraperů.
 *
 * Smysl: dřív každý scraper chybu spolkl, vypsal „staženo 0 inzerátů"
 * a běh se tvářil jako úspěšný. Nedostupný zdroj a zdroj bez nabídek
 * vypadaly stejně. Tady se z obojího stane rozlišitelný, popsaný stav.
 */

import axios from 'axios';
import { getPath } from './shape.js';

const TIMEOUT = () => Number(process.env.SCRAPER_TIMEOUT) || 30000;

// Hlavička ověřená průzkumem — s ní všechny tři portály vracejí plný výpis.
// Tempo dotazů drží scrapery na jedné stránce za 1,2 s, takže zdroj tím
// nezatěžujeme víc než běžné procházení webu.
export const UA = process.env.SCRAPER_UA
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
     + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Chyba zdroje — nese s sebou, kde se to stalo a co s tím. */
export class SourceError extends Error {
  constructor(message, { source, url, hint } = {}) {
    super(message);
    this.name = 'SourceError';
    this.source = source;
    this.url = url;
    this.hint = hint;
  }

  /** Víceřádkový výpis do logu, ať se to nemusí dohledávat. */
  format() {
    const lines = [`${this.source}: ${this.message}`];
    if (this.url) lines.push(`  URL: ${this.url}`);
    if (this.hint) lines.push(`  ${this.hint}`);
    return lines.join('\n');
  }
}

/** Přeloží síťovou chybu na větu, ze které je poznat, co dělat. */
export function describeHttpError(err) {
  if (err.response) {
    const s = err.response.status;
    if (s === 403 || s === 429) return `HTTP ${s} — zdroj nás blokuje (rate limit nebo detekce robota)`;
    if (s === 404) return `HTTP 404 — endpoint neexistuje, cesta se nejspíš změnila`;
    return `HTTP ${s} ${err.response.statusText || ''}`.trim();
  }
  if (err.code === 'ECONNABORTED') return `vypršel timeout (${TIMEOUT()} ms)`;
  if (err.code === 'ENOTFOUND') return 'doména nejde přeložit (DNS)';
  if (err.code === 'ECONNREFUSED') return 'spojení odmítnuto';
  if (err.code === 'CERT_HAS_EXPIRED') return 'zdroj má propadlý certifikát';
  return err.code ? `${err.code}: ${err.message}` : err.message;
}

/**
 * Stáhne jednu stránku JSON výpisu a ověří, že sedí očekávaný tvar.
 * Při jakékoli neshodě vyhodí SourceError — nikdy nevrátí prázdno potichu.
 */
export async function fetchJsonPage({ source, url, params, itemsPath, totalPath, hint }) {
  let res;
  try {
    res = await axios.get(url, {
      params,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout: TIMEOUT()
    });
  } catch (err) {
    throw new SourceError(describeHttpError(err), { source, url, hint });
  }

  if (typeof res.data === 'string') {
    throw new SourceError(
      'odpověď není JSON (přišlo HTML — endpoint nejspíš neexistuje)',
      { source, url, hint }
    );
  }

  const items = getPath(res.data, itemsPath);
  if (!Array.isArray(items)) {
    const keys = res.data && typeof res.data === 'object'
      ? Object.keys(res.data).slice(0, 12).join(', ')
      : String(typeof res.data);
    throw new SourceError(
      `v odpovědi není pole na cestě "${itemsPath}" — nahoře jsou klíče: ${keys}`,
      { source, url, hint }
    );
  }

  return { items, total: Number(getPath(res.data, totalPath) ?? items.length) };
}

/** Stáhne HTML stránku. Vyhodí SourceError, když se nedá načíst. */
export async function fetchHtml({ source, url, hint }) {
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': UA },
      timeout: TIMEOUT()
    });
    return String(res.data);
  } catch (err) {
    throw new SourceError(describeHttpError(err), { source, url, hint });
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
