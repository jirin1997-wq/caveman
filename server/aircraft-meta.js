// Meaning of the metadata fields that ADS-B actually carries.
//
// These tables are the ADS-B / Mode-S specification itself (emitter category
// codes) — they are not guesses. Anything the transponder does not send stays
// null and the UI shows a dash, rather than being filled in with a plausible
// value.

// Emitter category, as broadcast in the aircraft identification message.
const CATEGORIES = {
  A0: 'Nespecifikováno',
  A1: 'Lehké (do 7 t)',
  A2: 'Malé (7–34 t)',
  A3: 'Velké (34–136 t)',
  A4: 'Velké s vysokou turbulencí (B757)',
  A5: 'Těžké (nad 136 t)',
  A6: 'Vysoce výkonné',
  A7: 'Vrtulník',
  B1: 'Kluzák',
  B2: 'Balon / vzducholoď',
  B3: 'Parašutista',
  B4: 'Ultralight / paragliding',
  B6: 'Bezpilotní',
  B7: 'Kosmické',
  C0: 'Pozemní, nespecifikováno',
  C1: 'Pozemní — záchranné vozidlo',
  C2: 'Pozemní — obslužné vozidlo',
  C3: 'Pevná překážka',
};

// Squawk codes with a fixed international meaning. Worth surfacing loudly.
const SPECIAL_SQUAWKS = {
  7500: { label: 'ÚNOS', severity: 'critical' },
  7600: { label: 'ZTRÁTA SPOJENÍ', severity: 'critical' },
  7700: { label: 'NOUZE', severity: 'critical' },
  7000: { label: 'VFR (Evropa)', severity: 'info' },
  1200: { label: 'VFR (USA)', severity: 'info' },
  2000: { label: 'Vstup do řízeného prostoru', severity: 'info' },
};

function describeCategory(code) {
  if (!code) return null;
  return CATEGORIES[String(code).toUpperCase()] || null;
}

function describeSquawk(squawk) {
  if (!squawk) return null;
  return SPECIAL_SQUAWKS[String(squawk).padStart(4, '0')] || null;
}

/**
 * Wake turbulence class inferred from the emitter category alone.
 * Returns null for categories that do not imply one — inferring "Medium" for
 * an unknown type would be a guess dressed up as data.
 */
function wakeClass(category) {
  const c = String(category || '').toUpperCase();
  if (c === 'A5') return 'Heavy';
  if (c === 'A4') return 'Heavy (B757)';
  if (c === 'A3') return 'Medium';
  if (c === 'A2') return 'Light/Medium';
  if (c === 'A1') return 'Light';
  return null;
}

module.exports = { CATEGORIES, SPECIAL_SQUAWKS, describeCategory, describeSquawk, wakeClass };
