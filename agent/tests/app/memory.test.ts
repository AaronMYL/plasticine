import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { MemoryEntryInput } from '../../shared/state.ts';
import { brainChange } from '../state/helpers.ts';
import { CREDENTIAL_LINK_TEXT } from '../url-fixtures.ts';
import { call, json, pair, startTestApp, type TestApp, newRequestId } from './helpers.ts';

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

test('memory API returns owner URLs verbatim in self-quotes and model applicability conditions', async () => {
  const { t: app, cookie } = await start();
  const quote = entry(app, {
    text: CREDENTIAL_LINK_TEXT, kind: 'quote', basis: 'self_reported', applicability: CREDENTIAL_LINK_TEXT,
  });
  const detail = json(await call(app, 'GET', `/v2/memory/entries/${quote.id}`, { cookie }));
  assert.equal((detail['entry'] as Record<string, unknown>)['text'], CREDENTIAL_LINK_TEXT);
  assert.equal((detail['entry'] as Record<string, unknown>)['applicability'], CREDENTIAL_LINK_TEXT);
});

test('legacy memory returns both quotes and interpretations first pages in one request', async () => {
  const { t: app, cookie } = await start();
  const quote = entry(app, { text: '「用文字链接」', kind: 'quote', basis: 'self_reported' });
  const reading = entry(app);
  const board = json(await call(app, 'GET', '/v2/memory', { cookie }));
  const ids = (column: string, key: string): unknown[] =>
    ((board[column] as Record<string, unknown>)[key] as Record<string, unknown>[]).map((item) => item['id']);
  assert.deepEqual(ids('quotes', 'entries'), [quote.id]);
  assert.deepEqual(ids('interpretations', 'entries'), [reading.id]);
  assert.equal('agreements' in board, false);
});

test('legacy memory items are read-only: edit/archive endpoints removed, read requires auth', async () => {
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
