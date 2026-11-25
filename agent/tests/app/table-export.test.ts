import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { tableNumber } from '../../shared/api/index.ts';
import { xlsxSheets } from '../../src/cloud-tools/index.ts';
import { call, json, pair, startTestApp, type TestApp, newRequestId } from './helpers.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;

test('table numeric parser strips commas/currency and excludes percentages and text values', () => {
  assert.equal(tableNumber('1,234.5'), 1234.5);
  assert.equal(tableNumber('¥ 12'), 12);
  assert.equal(tableNumber('-3'), -3);
  assert.equal(tableNumber('12%'), null);
  assert.equal(tableNumber('3 份'), null);
  assert.equal(tableNumber(''), null);
});

test('download table saves xlsx in Tables folder with numeric cells, formula text, (2) deduping', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const body = { title: '投递记录', header: ['公司', '份数'], rows: [['示例公司', '3'], ['=1+1', '1,200']],
    total: ['合计', '1203'] };
  const first = await call(t, 'POST', '/v2/files/table', { cookie, body: { ...body, requestId: newRequestId('tb') } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const entry = json(first)['entry'] as Body;
  assert.match(String(entry['path']), /^表格\/投递记录 \d{4}-\d{2}-\d{2}\.xlsx$/);
  const data = readFileSync(join(t.directory, 'files', String(entry['path'])));
  const sheets = xlsxSheets(data);
  assert.deepEqual(sheets?.[0]?.rows, [['公司', '份数'], ['示例公司', '3'], ['=1+1', '1200'], ['合计', '1203']]);
  const second = await call(t, 'POST', '/v2/files/table', { cookie, body: { ...body, requestId: newRequestId('tb') } });
  assert.match(String((json(second)['entry'] as Body)['name']), / \(2\)\.xlsx$/);
});
