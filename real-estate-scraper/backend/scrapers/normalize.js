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
 * Tři podmínky, každá kvůli jedné záměně z ostrého běhu:
 *   - jednotka musí být opravdu m² nebo m2. Volnější „m" bralo jako plochu
 *     i „MHD 1 minuta pěšky" z popisku inzerátu a „300ms" z vloženého CSS.
 *   - mezera je oddělovač tisíců jen před skupinou přesně tří číslic,
 *     jinak z „3+1 68 m²" vyšlo 168 m²,
 *   - číslo nesmí navazovat na `+` ani na jinou číslici, jinak z
 *     „2+1 105 m²" vyšlo 1105 m².
 * Všechno by tiše posunulo cenu za metr, a to u velké části nabídky.
 */
export function parseArea(text) {
  if (!text) return null;
  const normalized = String(text).replace(/ /g, ' ');
  const match = normalized.match(/(?<![+\d])(\d{1,3}(?: \d{3})+|\d+(?:[.,]\d+)?)\s*m(?:²|2)(?!\d)/i);
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
 * Pražské katastrální části a obvod, pod který spadají.
 *
 * Zdroje klíčují Prahu dvěma nesmiřitelnými způsoby: Sreality a iDNES
 * většinou číslem obvodu („Praha 10"), Bezrealitky vždycky jen názvem
 * části („Praha - Vršovice"). Cenový rating se počítá proti mediánu
 * stejné čtvrti, takže celá pražská nabídka Bezrealitek stála stranou
 * a s ostatními zdroji se neporovnala.
 *
 * Tabulka je odečtená z adres, které nesou obojí („Murmanská, Praha 10 -
 * Vršovice"), a pokrývá všechny části, které se v datech vyskytly. Jde
 * o správní členění, které se nemění, takže patří do kódu — ne do dat.
 */
const PRAHA_CASTI = new Map([
  // Praha 1
  ['Josefov', 1],
  ['Malá Strana', 1],
  ['Nové Město', 1],
  ['Staré Město', 1],
  // Praha 2
  ['Nusle', 2],
  ['Vyšehrad', 2],
  // Praha 3
  ['Žižkov', 3],
  // Praha 4
  ['Braník', 4],
  ['Háje', 4],
  ['Hodkovičky', 4],
  ['Chodov', 4],
  ['Cholupice', 4],
  ['Kamýk', 4],
  ['Komořany', 4],
  ['Krč', 4],
  ['Kunratice', 4],
  ['Lhotka', 4],
  ['Libuš', 4],
  ['Modřany', 4],
  ['Písnice', 4],
  ['Podolí', 4],
  ['Šeberov', 4],
  ['Točná', 4],
  ['Újezd u Průhonic', 4],
  // Praha 5
  ['Hlubočepy', 5],
  ['Holyně', 5],
  ['Jinonice', 5],
  ['Košíře', 5],
  ['Lahovice', 5],
  ['Lipence', 5],
  ['Lochkov', 5],
  ['Motol', 5],
  ['Radlice', 5],
  ['Radotín', 5],
  ['Řeporyje', 5],
  ['Slivenec', 5],
  ['Smíchov', 5],
  ['Sobín', 5],
  ['Stodůlky', 5],
  ['Třebonice', 5],
  ['Velká Chuchle', 5],
  ['Zbraslav', 5],
  ['Zličín', 5],
  // Praha 6
  ['Břevnov', 6],
  ['Bubeneč', 6],
  ['Dejvice', 6],
  ['Hradčany', 6],
  ['Liboc', 6],
  ['Lysolaje', 6],
  ['Přední Kopanina', 6],
  ['Ruzyně', 6],
  ['Řepy', 6],
  ['Sedlec', 6],
  ['Střešovice', 6],
  ['Suchdol', 6],
  ['Veleslavín', 6],
  ['Vokovice', 6],
  // Praha 7
  ['Holešovice', 7],
  ['Troja', 7],
  // Praha 8
  ['Bohnice', 8],
  ['Čimice', 8],
  ['Ďáblice', 8],
  ['Dolní Chabry', 8],
  ['Karlín', 8],
  ['Kobylisy', 8],
  ['Libeň', 8],
  ['Střížkov', 8],
  // Praha 9
  ['Běchovice', 9],
  ['Čakovice', 9],
  ['Černý Most', 9],
  ['Dolní Počernice', 9],
  ['Hloubětín', 9],
  ['Horní Počernice', 9],
  ['Hostavice', 9],
  ['Hrdlořezy', 9],
  ['Kbely', 9],
  ['Klánovice', 9],
  ['Koloděje', 9],
  ['Kyje', 9],
  ['Letňany', 9],
  ['Miškovice', 9],
  ['Prosek', 9],
  ['Satalice', 9],
  ['Třeboradice', 9],
  ['Újezd nad Lesy', 9],
  ['Vinoř', 9],
  ['Vysočany', 9],
  // Praha 10
  ['Benice', 10],
  ['Dolní Měcholupy', 10],
  ['Dubeč', 10],
  ['Hájek u Uhříněvsi', 10],
  ['Horní Měcholupy', 10],
  ['Hostivař', 10],
  ['Kolovraty', 10],
  ['Královice', 10],
  ['Malešice', 10],
  ['Michle', 10],
  ['Nedvězí u Říčan', 10],
  ['Petrovice', 10],
  ['Pitkovice', 10],
  ['Strašnice', 10],
  ['Štěrboholy', 10],
  ['Uhříněves', 10],
  ['Vinohrady', 10],
  ['Vršovice', 10],
  ['Záběhlice', 10],
]);

/**
 * "Murmanská, Praha 10 - Vršovice" → { district: 'Praha 10', neighborhood: 'Vršovice' }
 * Zvládne i brněnský tvar "Veveří, Brno-střed".
 */
export function parseLocality(text) {
  if (!text) return { district: null, neighborhood: null };
  const clean = String(text).trim();

  // Číslo obvodu má přednost — je to tvar, kterým Prahu klíčuje většina
  // nabídky, a nese ho i adresa, ve které stojí obojí.
  const praha = clean.match(/(Praha\s+\d+)(?:\s*[-–]\s*([^,]+))?/i);
  if (praha) {
    return {
      district: praha[1].replace(/\s+/g, ' '),
      neighborhood: praha[2]?.trim() || null
    };
  }

  // Brno má místo číslovaných obvodů pojmenované městské části a každý
  // zdroj je píše jinak: „Brno - Černá Pole", „Brno-město - Bohunice",
  // „Brno-střed". Dřívější výraz z toho u prvního tvaru vyrobil čtvrť
  // „Brno -" a do sousedství dal název ulice. Praktický dopad byl velký:
  // celé brněnské inzeráty z iDNES spadly do jednoho slepence, Sreality
  // do „Brno-město", a ty dva zdroje se pak navzájem nikdy neporovnaly,
  // přestože jde o stejný trh. Cenový rating se počítá proti mediánu
  // stejné čtvrti, takže tím trpělo jádro produktu.
  //
  // Okres („-město", „-venkov") se zahazuje, rozhoduje městská část.
  const segments = clean.split(',').map((p) => p.trim()).filter(Boolean);
  const tail = segments[segments.length - 1] || '';

  // Praha bez čísla obvodu, jen s názvem části („Praha - Vršovice").
  // Tak to píšou Bezrealitky vždycky a Sreality občas; převod na obvod
  // je jediné, co ty inzeráty dostane do stejné srovnávací skupiny jako
  // zbytek nabídky. Neznámou část radši necháme stranou pod vlastním
  // klíčem, než abychom ji přiřadili špatně.
  const prazskaCast = tail.match(/^Praha\s*[-–]\s*(.+)$/i);
  if (prazskaCast) {
    const part = prazskaCast[1].trim().replace(/^Praha[-\s]/i, '').trim();
    const obvod = PRAHA_CASTI.get(part);
    return {
      district: obvod ? `Praha ${obvod}` : `Praha - ${part}`,
      neighborhood: part || null
    };
  }

  const brno = tail.match(/^Brno(?:-(?:město|mesto|venkov))?\s*[-–]?\s*(.*)$/i);

  if (brno) {
    const part = brno[1].trim().replace(/^Brno[-\s]/i, '').trim();
    return {
      district: part ? `Brno-${part}` : 'Brno',
      neighborhood: part || null
    };
  }

  return {
    district: segments[segments.length - 1] || null,
    neighborhood: segments[0] || null
  };
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

/**
 * Poslední pojistka proti nesmyslné ploše.
 *
 * Byt o 1 m² neexistuje, ale scraper takové číslo umí vyrobit, když se
 * chytí špatného kusu textu — a jedna taková hodnota vystřelí cenu za metr
 * do milionů a posune medián celé čtvrti. Radši plochu zahodit: inzerát
 * bez plochy se do mediánu za m² prostě nepočítá, kdežto špatná plocha
 * ho tiše pokazí.
 */
export function plausibleArea(value) {
  return Number.isFinite(value) && value >= 8 && value <= 2000 ? value : null;
}

/**
 * Poslední pojistka proti nesmyslné ceně.
 *
 * Byt za miliardu i byt za deset tisíc je chyba čtení, ne nabídka. Meze
 * jsou schválně široké — mají chytit řádovou záměnu, ne posuzovat, co je
 * drahé. Stejně jako u plochy platí: vyhodit záznam je lepší než nechat
 * ho pokazit medián.
 */
export function plausiblePrice(value) {
  return Number.isFinite(value) && value >= 200_000 && value <= 500_000_000 ? value : null;
}

/**
 * Cena za m² — počítá se, nikdy se nepřebírá ze zdroje.
 *
 * Výsledek mimo rozumné pásmo znamená, že je špatně cena nebo plocha,
 * jen nevíme která: byt za 104 mil. na 18 m² projde oběma pojistkami
 * zvlášť, ale dohromady dávají 5,8 mil. Kč/m². Takový záznam se do
 * mediánů nesmí dostat, i když jinak vypadá v pořádku.
 */
export function pricePerM2(price, sizeM2) {
  if (!price || !sizeM2) return null;
  const value = Math.round(price / sizeM2);
  return value >= 10_000 && value <= 600_000 ? value : null;
}

/**
 * Poskládá znormalizovaný záznam připravený k uložení.
 * Vrací null, když chybí povinná pole (URL, cena) — takový inzerát
 * nemá smysl ukládat, jen by kazil mediány.
 */
export function buildListing(raw) {
  const price = plausiblePrice(parsePrice(raw.price));
  if (!raw.url || !price) return null;

  const sizeM2 = plausibleArea(raw.sizeM2 ?? parseArea(raw.name));
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
