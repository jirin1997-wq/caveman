import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getPath, inspectJson, inspectHtml, SOURCES } from '../backend/scrapers/shape.js';

describe('getPath', () => {
  test('projde tečkovou cestou', () => {
    assert.equal(getPath({ a: { b: { c: 7 } } }, 'a.b.c'), 7);
  });

  test('chybějící mezičlánek vrátí undefined místo pádu', () => {
    assert.equal(getPath({ a: null }, 'a.b.c'), undefined);
    assert.equal(getPath({}, 'x.y'), undefined);
    assert.equal(getPath(null, 'a'), undefined);
  });
});

describe('inspectJson', () => {
  const shape = {
    itemsPath: '_embedded.estates',
    totalPath: 'result_size',
    required: ['hash_id', 'name'],
    optional: ['gps'],
    mappedIn: 'sreality.js → mapEstate()'
  };

  test('správný tvar projde', () => {
    const body = {
      result_size: 120,
      _embedded: { estates: [{ hash_id: 1, name: 'Byt 3+kk', gps: {} }] }
    };
    const r = inspectJson(body, shape);
    assert.equal(r.ok, true);
    assert.equal(r.itemCount, 1);
    assert.equal(r.total, 120);
    assert.deepEqual(r.missingRequired, []);
  });

  test('chybějící povinné pole nahlásí jménem', () => {
    const body = { _embedded: { estates: [{ name: 'Byt' }] } };
    const r = inspectJson(body, shape);
    assert.equal(r.ok, false);
    assert.deepEqual(r.missingRequired, ['hash_id']);
    assert.match(r.notes.join(' '), /hash_id/);
    assert.match(r.notes.join(' '), /mapEstate/);
  });

  test('volitelné pole nezpůsobí neúspěch, jen se vypíše', () => {
    const body = { _embedded: { estates: [{ hash_id: 1, name: 'Byt' }] } };
    const r = inspectJson(body, shape);
    assert.equal(r.ok, true);
    assert.deepEqual(r.missingOptional, ['gps']);
  });

  test('špatná cesta k poli vypíše klíče, které přišly', () => {
    const r = inspectJson({ results: [], meta: {} }, shape);
    assert.equal(r.ok, false);
    assert.equal(r.itemsFound, false);
    assert.match(r.notes.join(' '), /results, meta/);
  });

  test('prázdné pole se odliší od špatného tvaru', () => {
    const r = inspectJson({ _embedded: { estates: [] } }, shape);
    assert.equal(r.itemsFound, true);
    assert.equal(r.itemCount, 0);
    assert.match(r.notes.join(' '), /prázdné/);
  });

  test('HTML místo JSONu nespadne', () => {
    const r = inspectJson('<!doctype html><html></html>', shape);
    assert.equal(r.ok, false);
    assert.match(r.notes.join(' '), /není JSON/);
  });

  test('null nespadne', () => {
    assert.equal(inspectJson(null, shape).ok, false);
  });
});

describe('inspectHtml', () => {
  const shape = { selectors: ['.card', '.price'], mappedIn: 'developers.js → parseX()' };

  test('všechny selektory něco našly', () => {
    const r = inspectHtml(() => 3, shape);
    assert.equal(r.ok, true);
    assert.deepEqual(r.deadSelectors, []);
  });

  test('mrtvý selektor se pojmenuje', () => {
    const r = inspectHtml((sel) => (sel === '.card' ? 5 : 0), shape);
    assert.equal(r.ok, false);
    assert.deepEqual(r.deadSelectors, ['.price']);
    assert.match(r.notes.join(' '), /parseX/);
  });

  test('neplatný selektor se bere jako mrtvý, ne jako pád', () => {
    const r = inspectHtml(() => { throw new Error('bad selector'); }, shape);
    assert.equal(r.ok, false);
    assert.equal(r.hits.length, 2);
  });
});

describe('SOURCES', () => {
  test('každý zdroj má popsané, kde se opravuje', () => {
    for (const [key, s] of Object.entries(SOURCES)) {
      assert.ok(s.label, `${key}: chybí label`);
      assert.ok(s.url, `${key}: chybí url`);
      assert.ok(s.mappedIn, `${key}: chybí mappedIn`);
      assert.ok(['json', 'html'].includes(s.kind), `${key}: neznámý kind`);
      if (s.kind === 'json') assert.ok(s.itemsPath, `${key}: chybí itemsPath`);
      else assert.ok(s.selectors?.length, `${key}: chybí selektory`);
    }
  });
});
