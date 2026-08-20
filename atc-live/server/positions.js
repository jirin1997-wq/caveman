// Sort discovered LiveATC feeds into ATC positions.
//
// The classification is derived from the feed's own id and label (LiveATC names
// feeds like "lkpr_twr", "Frankfurt Tower"). Nothing is assumed about which
// positions an airport has — if no feed matches a position, that position
// simply is not offered.

const POSITIONS = [
  {
    key: 'atis',
    label: 'ATIS',
    hint: 'Informace o počasí a stavu letiště, smyčka dokola',
    idPatterns: [/_atis$/, /atis/],
    textPatterns: [/\batis\b/i],
  },
  {
    key: 'delivery',
    label: 'Clearance',
    hint: 'Vydání letového povolení před spuštěním',
    idPatterns: [/_del$/, /_cd$/, /deliv/],
    textPatterns: [/\bdeliver/i, /\bclearance\b/i],
  },
  {
    key: 'ground',
    label: 'Ground',
    hint: 'Pojíždění po odbavovací ploše a pojezdových drahách',
    idPatterns: [/_gnd$/, /_gr$/, /ground/],
    textPatterns: [/\bground\b/i, /\bapron\b/i],
  },
  {
    key: 'tower',
    label: 'Tower',
    hint: 'Vzlety, přistání a dráha samotná',
    idPatterns: [/_twr/, /tower/],
    textPatterns: [/\btower\b/i, /\btwr\b/i],
  },
  {
    key: 'approach',
    label: 'Approach',
    hint: 'Sestup a řazení na finále',
    idPatterns: [/_app/, /_arr/, /approach/],
    textPatterns: [/\bapproach\b/i, /\barrival\b/i, /\bdirector\b/i],
  },
  {
    key: 'departure',
    label: 'Departure',
    hint: 'Stoupání po vzletu',
    idPatterns: [/_dep/, /depart/],
    textPatterns: [/\bdeparture\b/i],
  },
  {
    key: 'radar',
    label: 'Radar / ACC',
    hint: 'Oblastní řízení na trati, mimo blízkost letiště',
    idPatterns: [/_ctr/, /_acc/, /center/, /centre/, /radar/],
    textPatterns: [/\bcenter\b/i, /\bcentre\b/i, /\bradar\b/i, /\bcontrol\b/i, /\bacc\b/i],
  },
];

const OTHER = { key: 'other', label: 'Ostatní', hint: 'Nezařazené feedy' };

function positionFor(feed) {
  const id = String(feed.id || '').toLowerCase();
  const label = String(feed.label || '');

  for (const pos of POSITIONS) {
    if (pos.idPatterns.some((re) => re.test(id))) return pos.key;
  }
  for (const pos of POSITIONS) {
    if (pos.textPatterns.some((re) => re.test(label))) return pos.key;
  }
  return OTHER.key;
}

/**
 * Group feeds by position, dropping positions that have no feed.
 * Returns [{ key, label, hint, feeds: [...] }] in operational order.
 */
function groupFeeds(feeds) {
  const groups = new Map();
  for (const feed of feeds || []) {
    const key = positionFor(feed);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...feed, position: key });
  }

  const ordered = [];
  for (const pos of [...POSITIONS, OTHER]) {
    const list = groups.get(pos.key);
    if (list && list.length) {
      ordered.push({ key: pos.key, label: pos.label, hint: pos.hint, feeds: list });
    }
  }
  return ordered;
}

module.exports = { POSITIONS, groupFeeds, positionFor };
