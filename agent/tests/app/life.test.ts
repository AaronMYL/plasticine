import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { REPLAYED_HEADER } from '../../shared/api/index.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

type Body = Record<string, unknown>;
const MINUTE = 60_000;

test('记账：没登录 401；记一笔 201、重发同一个 requestId 不记第二笔；账本按月分天；推 money_changed', async () => {
  t = await startTestApp();
  const body = { requestId: newRequestId('mn'), kind: 'expense', amountCents: 2_850, categoryId: 'food' };
  assert.equal((await call(t, 'POST', '/v2/money/entries', { body })).status, 401);
  assert.equal((await call(t, 'GET', '/v2/money?month=2026-10')).status, 401);
  const cookie = await pair(t);
  assert.equal((await call(t, 'GET', '/v2/money?month=2026-10', { cookie })).status, 200);
  const events = await openEvents(t, cookie);
  const first = await call(t, 'POST', '/v2/money/entries', { cookie, body });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const entry = json(first)['entry'] as Body;
  assert.equal(entry['categoryName'], '餐饮');
  const again = await call(t, 'POST', '/v2/money/entries', { cookie, body });
  assert.equal(again.headers.get(REPLAYED_HEADER), '1');
  const changed = await events.next('money_changed');
  events.close();
  assert.ok(changed.event.type === 'money_changed' && changed.event.entry.amountCents === 2_850);
  const month = json(await call(t, 'GET', '/v2/money?month=2026-10&tz=Asia%2FShanghai', { cookie }));
  assert.equal(month['expenseCents'], 2_850);
  assert.equal((month['days'] as Body[]).length, 1);
  assert.ok((month['categories'] as Body[]).length > 10);
});

test('记账：金额不是正的整数分 400；分类不存在 400；改一笔版本旧了 409 带现在那一笔；删了只打时间', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const bad = await call(t, 'POST', '/v2/money/entries', {
    cookie,
    body: { requestId: newRequestId('mn'), kind: 'expense', amountCents: 12.5 },
  });
  assert.equal(bad.status, 400);
  assert.equal(json(bad)['field'], 'amountCents');
  const noCategory = await call(t, 'POST', '/v2/money/entries', {
    cookie,
    body: { requestId: newRequestId('mn'), kind: 'expense', amountCents: 100, categoryId: 'nope' },
  });
  assert.equal(noCategory.status, 400);
  const created = json(await call(t, 'POST', '/v2/money/entries', {
    cookie,
    body: { requestId: newRequestId('mn'), kind: 'expense', amountCents: 100, merchant: '面馆' },
  }))['entry'] as Body;
  const id = String(created['id']);
  const edited = await call(t, 'PUT', `/v2/money/entries/${id}`, {
    cookie,
    body: { requestId: newRequestId('ed'), version: 1, amountCents: 150 },
  });
  assert.equal(((json(edited)['entry'] as Body)['merchant']), '面馆');
  const stale = await call(t, 'PUT', `/v2/money/entries/${id}`, {
    cookie,
    body: { requestId: newRequestId('ed'), version: 1, amountCents: 999 },
  });
  assert.equal(stale.status, 409);
  assert.equal(((json(stale)['current'] as Body)['amountCents']), 150);
  const removed = await call(t, 'POST', `/v2/money/entries/${id}/remove`, {
    cookie,
    body: { requestId: newRequestId('rm'), version: 2 },
  });
  assert.equal(((json(removed)['entry'] as Body)['deleted']), true);
  assert.notEqual(t.state.moneyEntries.get(id), undefined);
});

test('账户：加、改名、停用；资产按余额算；统计按周', async () => {
  t = await startTestApp();
  const cookie = await pair(t);
  const added = await call(t, 'POST', '/v2/money/accounts', {
    cookie,
    body: { requestId: newRequestId('ac'), name: '招行', type: 'debit', openingCents: 100_000 },
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  const account = json(added)['account'] as Body;
  await call(t, 'POST', '/v2/money/entries', {
    cookie,
    body: { requestId: newRequestId('mn'), kind: 'expense', amountCents: 1_000, accountId: account['id'] },
  });
  const money = json(await call(t, 'GET', '/v2/money?month=2026-10', { cookie }));
  assert.equal(((money['accounts'] as Body[])[0] ?? {})['balanceCents'], 99_000);
  assert.equal(money['netCents'], 99_000);
  const archived = await call(t, 'PUT', `/v2/money/accounts/${String(account['id'])}`, {
    cookie,
    body: { requestId: newRequestId('ac'), version: 1, archived: true },
  });
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.deepEqual(json(await call(t, 'GET', '/v2/money?month=2026-10', { cookie }))['accounts'], []);
  const stats = await call(t, 'GET', '/v2/money/stats?range=week&anchor=2026-10-27', { cookie });
  assert.equal(json(stats)['from'], '2026-10-26');
  assert.equal((await call(t, 'GET', '/v2/money/stats?range=day&anchor=2026-10-27', { cookie })).status, 400);
});
