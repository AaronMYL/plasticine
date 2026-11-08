import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, test } from 'node:test';
import { REPLAYED_HEADER } from '../../shared/api/index.ts';
import type { MemoryEntryInput } from '../../shared/state.ts';
import { Type } from 'typebox';
import { defineTool } from '../../src/brain/tools/registry.ts';
import { brainChange } from '../state/helpers.ts';
import { CLEAN_LINK_TEXT, CREDENTIAL_LINK_TEXT } from '../url-fixtures.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';
import { newRequestId } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(): Promise<{ t: TestApp; cookie: string }> {
  t = await startTestApp();
  return { t, cookie: await pair(t) };
}

function entry(app: TestApp, overrides: Partial<MemoryEntryInput> = {}) {
  // 来源账 2026-11-05 删了，旧条目只留着来源 id。
  const sourceId = 'source-user-said';
  const input: MemoryEntryInput = {
    text: '用户喜欢文字链接，不要按钮',
    kind: 'interpretation',
    basis: 'inferred',
    sourceId,
    provenance: '10-26 对话里推的',
    ...overrides,
  };
  return app.state.memory.create(input, brainChange());
}

test('自述原话在记忆接口原样返回，同条记忆的模型适用条件继续清洗', async () => {
  const { t: app, cookie } = await start();
  const quote = entry(app, {
    text: CREDENTIAL_LINK_TEXT, kind: 'quote', basis: 'self_reported', applicability: CREDENTIAL_LINK_TEXT,
  });
  const detail = json(await call(app, 'GET', `/v2/memory/entries/${quote.id}`, { cookie }));
  assert.equal((detail['entry'] as Record<string, unknown>)['text'], CREDENTIAL_LINK_TEXT);
  assert.equal((detail['entry'] as Record<string, unknown>)['applicability'], CLEAN_LINK_TEXT);
});

test('记忆三栏一次拿到：原话、解释、约定各自第一页', async () => {
  const { t: app, cookie } = await start();
  const quote = entry(app, { text: '「用文字链接」', kind: 'quote', basis: 'self_reported' });
  const reading = entry(app);
  const agreement = app.state.agreements.create({ kind: 'collaboration', text: '先给结论', scope: '对话' }, brainChange());
  const board = json(await call(app, 'GET', '/v2/memory', { cookie }));
  const ids = (column: string, key: string): unknown[] =>
    ((board[column] as Record<string, unknown>)[key] as Record<string, unknown>[]).map((item) => item['id']);
  assert.deepEqual(ids('quotes', 'entries'), [quote.id]);
  assert.deepEqual(ids('interpretations', 'entries'), [reading.id]);
  assert.deepEqual(ids('agreements', 'agreements'), [agreement.id]);
});

test('旧记忆条目只读（2026-11-03）：改、归档的接口没有了，读要登录', async () => {
  const { t: app, cookie } = await start();
  const reading = entry(app);
  const path = `/v2/memory/entries/${reading.id}`;
  const edit = await call(app, 'PUT', path, { cookie, body: { requestId: newRequestId(), version: 1, stale: true } });
  assert.equal(edit.status, 405);
  const archive = await call(app, 'POST', `${path}/archive`, { cookie, body: { requestId: newRequestId(),
    version: 1 } });
  assert.equal(archive.status, 404);
  assert.deepEqual(app.state.memory.require(reading.id), reading);
  assert.equal((await call(app, 'GET', path, { cookie })).status, 200);
  assert.equal((await call(app, 'GET', '/v2/memory')).status, 401);
});
