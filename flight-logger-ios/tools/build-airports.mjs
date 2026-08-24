#!/usr/bin/env node
/**
 * Converts the OurAirports airports.csv into the JSON the app reads.
 *
 * The bundled seed database (FlightLogger/Resources/airports.json) carries
 * positions and codes only, with `elevation: null` — approximate coordinates
 * are fine for naming a departure, but a wrong field elevation would feed
 * straight into the AGL the detector decides on. Run this to get real
 * elevations from a real dataset:
 *
 *   curl -O https://davidmegginson.github.io/ourairports-data/airports.csv
 *   node tools/build-airports.mjs airports.csv --country CZ,SK,AT,DE,PL > airports.json
 *
 * Then import airports.json in the app: Nastavení → Terén → Importovat
 * databázi letišť. The imported file overrides the bundled seed.
 *
 * OurAirports data is public domain. Elevations are published field
 * elevations in feet; this script converts them to meters.
 */

import { readFileSync } from 'node:fs';

const FEET_TO_METERS = 0.3048;

/** Airport types worth keeping. `closed` and `heliport` are off by default. */
const DEFAULT_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

/**
 * Minimal RFC 4180 CSV parser. OurAirports quotes any field containing a
 * comma, and airport names contain plenty of them.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function convert(csvText, { types = DEFAULT_TYPES, countries = null } = {}) {
  const rows = parseCSV(csvText);
  if (rows.length === 0) return [];

  const header = rows[0];
  const col = (name) => header.indexOf(name);
  const iIdent = col('ident');
  const iType = col('type');
  const iName = col('name');
  const iLat = col('latitude_deg');
  const iLon = col('longitude_deg');
  const iElev = col('elevation_ft');
  const iCountry = col('iso_country');
  const iGps = col('gps_code');
  const iLocal = col('local_code');

  if (iIdent < 0 || iLat < 0 || iLon < 0) {
    throw new Error('Nevypadá to jako OurAirports CSV — chybí sloupce ident/latitude_deg/longitude_deg.');
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < header.length) continue;
    if (types && !types.has(row[iType])) continue;
    if (countries && !countries.has(row[iCountry])) continue;

    const latitude = Number(row[iLat]);
    const longitude = Number(row[iLon]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const feet = Number(row[iElev]);
    // An empty elevation_ft parses to 0, which would put every unknown field
    // at sea level and quietly wreck AGL. Only a non-empty value counts.
    const elevation = row[iElev] !== '' && Number.isFinite(feet)
      ? Math.round(feet * FEET_TO_METERS * 10) / 10
      : null;

    out.push({
      code: row[iGps] || row[iIdent] || row[iLocal],
      name: row[iName],
      latitude: Math.round(latitude * 1e6) / 1e6,
      longitude: Math.round(longitude * 1e6) / 1e6,
      elevation
    });
  }
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Použití: node tools/build-airports.mjs <airports.csv> [--country CZ,SK] [--all-types] > airports.json');
    process.exit(1);
  }
  const countryArg = args[args.indexOf('--country') + 1];
  const countries = args.includes('--country') && countryArg
    ? new Set(countryArg.split(',').map((c) => c.trim().toUpperCase()))
    : null;
  const types = args.includes('--all-types') ? null : DEFAULT_TYPES;

  const list = convert(readFileSync(file, 'utf8'), { types, countries });
  const withElevation = list.filter((a) => a.elevation !== null).length;
  process.stderr.write(`${list.length} letišť, z toho ${withElevation} s nadmořskou výškou\n`);
  process.stdout.write(JSON.stringify(list, null, 1) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}
