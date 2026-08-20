/**
 * Ověří všechny zdroje jedním během — nic neukládá do databáze.
 *
 *   npm run probe            # všechny zdroje, Praha
 *   npm run probe -- brno    # jiné město
 *
 * Ke každému zdroji vypíše, jestli odpověděl, jestli sedí očekávaný tvar
 * a která konkrétní pole chybí. Surové odpovědi ukládá do `probe-output/`,
 * aby se dalo mapování opravit podle skutečných dat, ne podle dohadů.
 */

import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { SOURCES, inspectJson, inspectHtml } from './shape.js';
import { UA } from './http.js';

const OUT_DIR = path.resolve(process.cwd(), 'probe-output');
const TIMEOUT = Number(process.env.SCRAPER_TIMEOUT) || 30000;

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`
};

function save(name, content) {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, content);
    return file;
  } catch (err) {
    return `(uložení selhalo: ${err.message})`;
  }
}

/** Vrátí popis chyby, který uživateli řekne, co dělat dál. */
function describeError(err) {
  if (err.response) {
    return `HTTP ${err.response.status} ${err.response.statusText || ''}`.trim();
  }
  if (err.code === 'ECONNABORTED') return `vypršel timeout (${TIMEOUT} ms)`;
  if (err.code === 'ENOTFOUND') return 'doména neexistuje / nejde přeložit DNS';
  if (err.code === 'ECONNREFUSED') return 'spojení odmítnuto';
  return err.code ? `${err.code}: ${err.message}` : err.message;
}

async function probeJson(key, shape, city) {
  const res = await axios.get(shape.url, {
    params: shape.params ? shape.params(city) : undefined,
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    timeout: TIMEOUT,
    validateStatus: () => true
  });

  const body = res.data;
  const raw = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  const file = save(`${key}.json`, raw);

  if (res.status >= 400) {
    return { status: res.status, result: null, file, fatal: `HTTP ${res.status}` };
  }
  if (typeof body === 'string') {
    return {
      status: res.status, result: null, file,
      fatal: 'odpověď není JSON (nejspíš HTML stránka — endpoint asi neexistuje)'
    };
  }
  return { status: res.status, result: inspectJson(body, shape), file };
}

async function probeHtml(key, shape) {
  const res = await axios.get(shape.url, {
    headers: { 'User-Agent': UA },
    timeout: TIMEOUT,
    validateStatus: () => true
  });

  const file = save(`${key}.html`, String(res.data));
  if (res.status >= 400) {
    return { status: res.status, result: null, file, fatal: `HTTP ${res.status}` };
  }

  const $ = cheerio.load(res.data);
  return { status: res.status, result: inspectHtml((sel) => $(sel).length, shape), file };
}

function report(key, shape, outcome) {
  const head = `${C.b(shape.label)} ${C.dim('(' + key + ')')}`;

  if (outcome.error) {
    console.log(`${C.bad('✗')} ${head}\n   ${C.bad(outcome.error)}\n   ${C.dim(shape.url)}`);
    return false;
  }
  if (outcome.fatal) {
    console.log(
      `${C.bad('✗')} ${head}\n   ${C.bad(outcome.fatal)}\n` +
        `   ${C.dim('surová odpověď: ' + outcome.file)}\n   ${C.dim('oprav: ' + shape.mappedIn)}`
    );
    return false;
  }

  const r = outcome.result;
  const mark = r.ok ? C.ok('✓') : C.warn('!');
  const lines = [`${mark} ${head}`];

  if (shape.kind === 'json') {
    lines.push(`   HTTP ${outcome.status}, položek ${r.itemCount}${r.total != null ? ` z ${r.total}` : ''}`);
    if (r.sampleKeys.length) lines.push(`   ${C.dim('klíče položky: ' + r.sampleKeys.join(', '))}`);
    if (r.missingOptional.length) {
      lines.push(`   ${C.warn('chybí volitelná: ' + r.missingOptional.join(', '))}`);
    }
  } else {
    for (const h of r.hits) {
      const m = h.count > 0 ? C.ok(String(h.count)) : C.bad('0');
      lines.push(`   ${m}× ${C.dim(h.selector)}`);
    }
  }

  for (const n of r.notes) lines.push(`   ${C.bad(n)}`);
  lines.push(`   ${C.dim('surová odpověď: ' + outcome.file)}`);
  if (!r.ok) lines.push(`   ${C.dim('oprav: ' + shape.mappedIn)}`);

  console.log(lines.join('\n'));
  return r.ok;
}

export async function probeAll(city = 'praha') {
  console.log(`\n${C.b('Ověření zdrojů')} — město: ${city}\n`);

  const results = {};
  for (const [key, shape] of Object.entries(SOURCES)) {
    let outcome;
    try {
      outcome = shape.kind === 'json'
        ? await probeJson(key, shape, city)
        : await probeHtml(key, shape);
    } catch (err) {
      outcome = { error: describeError(err) };
    }
    results[key] = report(key, shape, outcome);
    console.log('');
  }

  const ok = Object.values(results).filter(Boolean).length;
  const total = Object.keys(results).length;
  const verdict = ok === total ? C.ok(`${ok}/${total} v pořádku`)
    : ok === 0 ? C.bad(`0/${total} — neprošel žádný zdroj`)
    : C.warn(`${ok}/${total} v pořádku`);

  console.log(`${C.b('Výsledek:')} ${verdict}`);
  if (ok < total) {
    console.log(C.dim(`Surové odpovědi najdeš v ${OUT_DIR}/ — podle nich oprav mapovací funkce.`));
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const city = process.argv[2] || 'praha';
  probeAll(city)
    .then((r) => process.exit(Object.values(r).some(Boolean) ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
