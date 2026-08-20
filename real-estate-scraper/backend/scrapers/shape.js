/**
 * Co od každého zdroje čekáme za tvar stránky — a nástroj, který to ověří.
 *
 * Popisy níže jsou odečtené z živých odpovědí (běh „Průzkum zdrojů"), ne
 * odhadnuté. Smysl souboru zůstává: když zdroj změní tvar, `npm run probe`
 * má říct KTERÝ selektor přestal platit, ne aby scraper tiše vrátil prázdno.
 *
 * Soubor je čistý — bez I/O, aby šel testovat samostatně.
 */

export const SOURCES = {
  sreality: {
    label: 'Sreality',
    kind: 'html',
    confidence: 'ověřeno — HTML výpis, karta je <li id="estate-list-item-…">',
    url: 'https://www.sreality.cz/hledani/prodej/byty/praha',
    // Třídy jsou emotion hashe (css-abbpa2) a mění se s každým nasazením
    // jejich webu — proto se míří na id, ne na třídu.
    selectors: ['li[id^="estate-list-item"]', 'a[href*="/detail/"]'],
    mappedIn: 'backend/scrapers/sreality.js → parseListPage()'
  },

  idnes: {
    label: 'iDNES Reality',
    kind: 'html',
    confidence: 'ověřeno — HTML výpis s pojmenovanými BEM třídami',
    url: 'https://reality.idnes.cz/s/prodej/byty/praha/',
    selectors: ['.c-products__price', 'a[href*="/detail/prodej/byt/"]'],
    mappedIn: 'backend/scrapers/idnes.js → parseListPage()'
  },

  bezrealitky: {
    label: 'Bezrealitky',
    kind: 'html',
    confidence: 'ověřeno — HTML výpis; vedle hashovaných tříd nese i stabilní propertyCard',
    url: 'https://www.bezrealitky.cz/vyhledat?offerType=PRODEJ&estateType=BYT',
    selectors: ['article.propertyCard', '.propertyPrice', 'a[href*="/nemovitosti-byty-domy/"]'],
    mappedIn: 'backend/scrapers/bezrealitky.js → parseListPage()'
  },

  trigema: {
    label: 'Trigema (developer)',
    kind: 'html',
    confidence: 'nefunkční — ceny nejsou ve statickém HTML, výpis dotahuje JavaScript',
    url: 'https://www.trigema.cz/cs/nove-byty-praha/',
    selectors: ['[data-project-item]', '[data-price]'],
    mappedIn: 'backend/scrapers/developers.js → parseTrigema()'
  },

  centralGroup: {
    label: 'Central Group (developer)',
    kind: 'html',
    confidence: 'nefunkční — doména central-group.cz vrací na výpisu 404 a web je JS shell',
    url: 'https://www.central-group.cz/',
    selectors: ['.property-card', '[data-property]'],
    mappedIn: 'backend/scrapers/developers.js → parseCentralGroup()'
  },

  ekospol: {
    label: 'Ekospol (developer)',
    kind: 'html',
    confidence: 'nefunkční — stránka se načte, ale ceny ve statickém HTML nejsou',
    url: 'https://www.ekospol.cz/byty/prodej-bytu-praha/',
    selectors: ['.ekospolProperty', '.property-price'],
    mappedIn: 'backend/scrapers/developers.js → parseEkospol()'
  }
};

/** Vyzvedne hodnotu podle tečkové cesty. `getPath(o, 'a.b')` → o.a.b, jinak undefined. */
export function getPath(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/**
 * Porovná skutečnou odpověď s očekávaným tvarem.
 * Nikdy nevyhazuje — vrací nález, se kterým se dá pracovat dál.
 */
export function inspectJson(body, shape) {
  const out = {
    ok: false,
    itemsPath: shape.itemsPath,
    itemsFound: false,
    itemCount: 0,
    total: null,
    sampleKeys: [],
    missingRequired: [],
    missingOptional: [],
    notes: []
  };

  if (body == null || typeof body !== 'object') {
    out.notes.push(`odpověď není JSON objekt (dostali jsme ${typeof body})`);
    return out;
  }

  out.topLevelKeys = Object.keys(body).slice(0, 24);

  const items = getPath(body, shape.itemsPath);
  if (!Array.isArray(items)) {
    out.notes.push(
      `cesta "${shape.itemsPath}" nevede na pole` +
        (out.topLevelKeys.length ? ` — nahoře jsou klíče: ${out.topLevelKeys.join(', ')}` : '')
    );
    return out;
  }

  out.itemsFound = true;
  out.itemCount = items.length;
  out.total = getPath(body, shape.totalPath) ?? null;

  if (items.length === 0) {
    out.notes.push('pole je prázdné — buď zdroj nic nevrátil, nebo nesedí parametry dotazu');
    return out;
  }

  const first = items[0] || {};
  out.sampleKeys = Object.keys(first).slice(0, 40);
  out.missingRequired = (shape.required || []).filter((f) => !(f in first));
  out.missingOptional = (shape.optional || []).filter((f) => !(f in first));
  out.ok = out.missingRequired.length === 0;

  if (!out.ok) {
    out.notes.push(`chybí povinná pole: ${out.missingRequired.join(', ')} — oprav ${shape.mappedIn}`);
  }
  return out;
}

/**
 * Totéž pro HTML zdroje: kolik prvků najde každý selektor.
 * `query` je funkce (selector) => počet, aby modul nezávisel na cheeriu.
 */
export function inspectHtml(query, shape) {
  const hits = (shape.selectors || []).map((sel) => {
    let n = 0;
    try {
      n = query(sel);
    } catch {
      n = -1;
    }
    return { selector: sel, count: n };
  });

  const dead = hits.filter((h) => h.count <= 0).map((h) => h.selector);
  return {
    ok: hits.length > 0 && dead.length === 0,
    hits,
    deadSelectors: dead,
    notes: dead.length
      ? [`selektory nic nenašly: ${dead.join(', ')} — oprav ${shape.mappedIn}`]
      : []
  };
}
