// POST /v2/files/table：对话里的表格存进文件页「表格」文件夹（11-16）。
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

test('表格里的数：千分位和货币符号去掉，百分数和带字的不算', () => {
  assert.equal(tableNumber('1,234.5'), 1234.5);
  assert.equal(tableNumber('¥ 12'), 12);
  assert.equal(tableNumber('-3'), -3);
  assert.equal(tableNumber('12%'), null);
  assert.equal(tableNumber('3 份'), null);
  assert.equal(tableNumber(''), null);
});

test('下载表格：存成 xlsx 放进「表格」文件夹，数按数存、「=」开头按文字；重名往后加 (2)', async () => {
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
  // 公式格读回来是空的；「=1+1」原样读回说明按文字存了。「1,200」读回 1200 说明按数存了。
  assert.deepEqual(sheets?.[0]?.rows, [['公司', '份数'], ['示例公司', '3'], ['=1+1', '1200'], ['合计', '1203']]);
  const second = await call(t, 'POST', '/v2/files/table', { cookie, body: { ...body, requestId: newRequestId('tb') } });
  assert.match(String((json(second)['entry'] as Body)['name']), / \(2\)\.xlsx$/);
});
