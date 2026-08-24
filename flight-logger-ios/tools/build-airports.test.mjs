import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCSV, convert } from './build-airports.mjs';

const SAMPLE = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","gps_code","iata_code","local_code","home_link","wikipedia_link","keywords"
1,"LKPR","large_airport","Vaclav Havel Airport Prague, Ruzyne",50.1008,14.26,1247,"EU","CZ","CZ-ST","Prague","yes","LKPR","PRG","","","",""
2,"LKZA","small_airport","Zbraslavice Airfield",49.8319,15.2069,,"EU","CZ","CZ-ST","Zbraslavice","no","LKZA","","","","",""
3,"XX01","closed","Nekde zavrene",49.0,15.0,500,"EU","CZ","CZ-ST","","no","","","","","",""
4,"LZIB","large_airport","Bratislava",48.1702,17.2127,436,"EU","SK","SK-BL","Bratislava","yes","LZIB","BTS","","","",""
`;

test('parseCSV keeps commas inside quoted fields', () => {
  const rows = parseCSV(SAMPLE);
  assert.equal(rows[1][3], 'Vaclav Havel Airport Prague, Ruzyne');
  assert.equal(rows.length, 5);
});

test('converts feet to meters', () => {
  const list = convert(SAMPLE);
  const prague = list.find((a) => a.code === 'LKPR');
  assert.equal(prague.elevation, 380.1); // 1247 ft
});

test('empty elevation stays null instead of becoming sea level', () => {
  const list = convert(SAMPLE);
  const zbraslavice = list.find((a) => a.code === 'LKZA');
  assert.equal(zbraslavice.elevation, null);
});

test('closed airfields are dropped', () => {
  const list = convert(SAMPLE);
  assert.equal(list.find((a) => a.code === 'XX01'), undefined);
});

test('country filter', () => {
  const list = convert(SAMPLE, { countries: new Set(['CZ']) });
  assert.deepEqual(list.map((a) => a.code).sort(), ['LKPR', 'LKZA']);
});

test('rejects a CSV that is not OurAirports', () => {
  assert.throws(() => convert('a,b,c\n1,2,3\n'), /OurAirports/);
});
