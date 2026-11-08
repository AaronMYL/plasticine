import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { brainChange } from '../state/helpers.ts';
import { call, json, openEvents, pair, startTestApp, type TestApp } from './helpers.ts';
import { newDeviceKey, newRequestId, signedCall, type TestDeviceKey } from './signing.ts';

let t: TestApp | undefined;

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(): Promise<{ t: TestApp; cookie: string; key: TestDeviceKey }> {
  t = await startTestApp();
  const cookie = await pair(t);
  const key = newDeviceKey();
  t.clock.advance(20 * 60_000);
  return { t, cookie, key };
}

const input = { kind: 'collaboration' as const, text: '回复先给结论', scope: '所有对话' };

test('迁移约定保留历史生效状态，不自动要求确认；用户主动确认仍保留原生效时间并发事件', async () => {
  const { t: app, cookie, key } = await start();
  const effectiveAt = '2026-09-01T00:00:00.000Z';
  const migrated = app.state.agreements.importEffective(input, effectiveAt, { table: 'guide_sections' }, '旧指南迁入');
  const listed = json(await call(app, 'GET', '/v2/agreements', { cookie }));
  const row = (listed['agreements'] as Record<string, unknown>[])[0];
  assert.equal(row?.['awaitingConfirmation'], false);
  const events = await openEvents(app, cookie);
  const body = { requestId: newRequestId(), version: 1, decision: 'confirm' };
  const reply = await signedCall(app, 'POST', `/v2/agreements/${migrated.id}/confirm`, body, { cookie, key });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  const agreement = json(reply)['agreement'] as Record<string, unknown>;
  assert.equal(agreement['state'], 'active');
  assert.equal(agreement['effectiveAt'], effectiveAt);
  assert.equal(agreement['awaitingConfirmation'], false);
  const changed = await events.next('agreement_changed');
  assert.equal(changed.event.type === 'agreement_changed' && changed.event.agreement.id, migrated.id);
  events.close();
});

test('待议的约定确认后生效、从现在起算；撤掉的约定不再生效', async () => {
  const { t: app, cookie, key } = await start();
  const created = app.state.agreements.create(input, brainChange());
  const confirm = { requestId: newRequestId(), version: 1, decision: 'confirm', reason: '就这么办' };
  const active = await signedCall(app, 'POST', `/v2/agreements/${created.id}/confirm`, confirm, { cookie, key });
  assert.equal((json(active)['agreement'] as Record<string, unknown>)['state'], 'active');
  assert.notEqual(app.state.agreements.require(created.id).effectiveAt, null);
  const revoke = { requestId: newRequestId(), version: 2, decision: 'revoke' };
  const revoked = await signedCall(app, 'POST', `/v2/agreements/${created.id}/confirm`, revoke, { cookie, key });
  assert.equal((json(revoked)['agreement'] as Record<string, unknown>)['state'], 'revoked');
  const last = app.state.agreements.history(created.id).at(-1);
  assert.equal(last?.actor, 'user');
  assert.notEqual(last?.confirmedByDeviceId, null);
});

test('本人老会话无钥匙、不带签名即可确认约定，记录真实设备', async () => {
  const { t: app, cookie } = await start();
  const created = app.state.agreements.create(input, brainChange());
  const body = { requestId: newRequestId(), version: 1, decision: 'confirm' };
  const reply = await call(app, 'POST', `/v2/agreements/${created.id}/confirm`, { cookie, body });
  assert.equal(reply.status, 200);
  const confirmed = app.state.agreements.require(created.id);
  assert.equal(confirmed.state, 'active');
  assert.equal(confirmed.confirmedByDeviceId, app.state.devices.list()[0]!.id);
});

test('采用提议和编辑生效约定均用本人会话，新历史不声称签名，已有历史原样保留', async () => {
  const { t: app, cookie } = await start();
  const created = app.state.agreements.create(input, brainChange());
  const proposed = app.state.agreements.update(created.id, created.version,
    { proposedDiff: '- 回复先给结论\n+ 先说结果' }, brainChange());
  const earlier = app.state.agreements.history(created.id);
  const adopted = await call(app, 'POST', `/v2/agreements/${created.id}/confirm`, { cookie,
    body: { requestId: newRequestId(), version: proposed.version, decision: 'adopt' } });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
  const active = app.state.agreements.require(created.id);
  assert.equal(active.text, '先说结果');
  const edited = await call(app, 'POST', `/v2/agreements/${created.id}/edit`, { cookie,
    body: { requestId: newRequestId(), version: active.version, text: '先说结果，再给依据', scope: input.scope } });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const history = app.state.agreements.history(created.id);
  assert.deepEqual(history.slice(0, earlier.length), earlier);
  const added = history.slice(earlier.length);
  assert.equal(added.length, 4);
  assert.ok(added.every((entry) => entry.actor === 'user' && !entry.reason.includes('签名')));
  assert.equal(app.state.agreements.require(created.id).confirmedByDeviceId, app.state.devices.list()[0]!.id);
});
