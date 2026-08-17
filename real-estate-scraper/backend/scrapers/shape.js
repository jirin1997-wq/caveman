/**
 * Co od každého zdroje čekáme za tvar odpovědi — a nástroj, který to ověří.
 *
 * Proč to existuje: endpointy níže nebyly otestované proti živým webům
 * (vývojové prostředí nepustí odchozí spojení). Místo aby scraper při
 * neshodě tiše vrátil prázdný seznam, chceme vědět, KTERÉ konkrétní pole
 * chybí a jak odpověď doopravdy vypadá. `npm run probe` to vypíše.
 *
 * Soubor je čistý — bez I/O, aby šel testovat samostatně.
 */

/**
 * ID krajů pro Sreality. Praha = 10 je jisté; u Brna (Jihomoravský kraj)
 * si jistý nejsem — v číslování krajů to bývá 14 i 20 podle toho, jestli
 * se počítá od Prahy vzestupně. Proto jde přebít proměnnou prostředí,
 * ať kvůli špatné konstantě nemusí nikdo sahat do kódu.
 *   SREALITY_REGION_PRAHA=10 SREALITY_REGION_BRNO=20 npm run probe
 */
export const SREALITY_REGIONS = {
  praha: Number(process.env.SREALITY_REGION_PRAHA) || 10,
  brno: Number(process.env.SREALITY_REGION_BRNO) || 14
};

export const SOURCES = {
  sreality: {
    label: 'Sreality',
    kind: 'json',
    confidence: 'střední — veřejné API, které pohání jejich vlastní web',
    url: 'https://www.sreality.cz/api/cs/v2/estates',
    params: (city) => ({
      category_main_cb: 1,
      category_type_cb: 1,
      locality_region_id: SREALITY_REGIONS[city],
      per_page: 3,
      page: 1
    }),
    itemsPath: '_embedded.estates',
    totalPath: 'result_size',
    required: ['hash_id', 'name', 'locality'],
    optional: ['price', 'price_czk', 'gps', 'labels', '_links'],
    mappedIn: 'backend/scrapers/sreality.js → mapEstate()'
  },

  idnes: {
    label: 'iDNES Reality',
    kind: 'json',
    confidence: 'nízká — endpoint i tvar odpovědi jsou odhad',
    url: 'https://reality.idnes.cz/api/v1/estates',
    params: () => ({ page: 1, limit: 3, type: 'byt', transaction: 'prodej' }),
    itemsPath: 'result.items',
    totalPath: 'result.total',
    required: ['id', 'title', 'price'],
    optional: ['locality', 'usableArea', 'disposition', 'gps', 'photos'],
    mappedIn: 'backend/scrapers/idnes.js → mapEstate()'
  },

  bezrealitky: {
    label: 'Bezrealitky',
    kind: 'json',
    confidence: 'nízká — nejspíš rovnou špatně, web podle všeho jede na GraphQL',
    url: 'https://api.bezrealitky.cz/v2/estates',
    params: (city) => ({ city, type: 'flat', transaction: 'sale', page: 1, limit: 3 }),
    itemsPath: 'data',
    totalPath: 'pagination.total',
    required: ['id', 'title', 'price'],
    optional: ['address', 'usableArea', 'disposition', 'latitude', 'longitude', 'images'],
    mappedIn: 'backend/scrapers/bezrealitky.js → mapEstate()'
  },

  trigema: {
    label: 'Trigema (developer)',
    kind: 'html',
    confidence: 'nízká — CSS selektory jsou vymyšlené, ne odečtené z HTML',
    url: 'https://www.trigema.cz/nemovitosti/',
    selectors: ['[data-project-item]', '[data-title]', '[data-price]', '[data-area]'],
    mappedIn: 'backend/scrapers/developers.js → parseTrigema()'
  },

  centralGroup: {
    label: 'Central Group (developer)',
    kind: 'html',
    confidence: 'nízká — CSS selektory jsou vymyšlené',
    url: 'https://www.centralgroup.cz/nemovitosti/',
    selectors: ['.property-card', '[data-property]', '[data-price]', '.price'],
    mappedIn: 'backend/scrapers/developers.js → parseCentralGroup()'
  },

  ekospol: {
    label: 'Ekospol (developer)',
    kind: 'html',
    confidence: 'nízká — CSS selektory jsou vymyšlené',
    url: 'https://www.ekospol.cz/nemovitosti/praha/',
    selectors: ['.ekospolProperty', '[data-property-listing]', '.property-price'],
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
