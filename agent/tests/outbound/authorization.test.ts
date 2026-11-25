import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { OutboundAuthorizer } from '../../src/outbound/index.ts';
import { MAIN_LINE_ID, openState, type StateService } from '../../src/state/index.ts';

let state: StateService;
let grants: OutboundAuthorizer;
let clock: number;
const initial = Date.parse('2026-11-10T00:00:00.000Z');
const scope = { actorId: MAIN_LINE_ID, lineId: MAIN_LINE_ID, projectId: null, scheduleId: null };
const spec = { channel: 'fixture.messages', account: 'account-fixture', recipients: ['recipient-one'],
  category: 'message', content: '测试消息' };
const input = { actor: MAIN_LINE_ID, channel: spec.channel, account: spec.account,
  recipientMode: 'list' as const, recipients: ['recipient-one'], category: 'message', fixedTexts: null,
  scope: { kind: 'always' as const }, expiresAt: null };
const confirmation = { deviceId: 'fixture-device', confirmedAt: new Date(initial).toISOString() };
const call = (id: string) => ({ toolCallId: id, toolName: 'fixture_send', argsDigest: 'a'.repeat(64) });

beforeEach(() => {
  clock = initial;
  state = openState({ path: ':memory:', now: () => new Date(clock).toISOString() });
  state.lines.main();
  grants = new OutboundAuthorizer(state, () => new Date(clock));
});
afterEach(() => state.close());

test('Grant must match actor, channel, account, full recipients, kind, and fixed text', () => {
  state.outboundGrants.create({ ...input, actor: 'mate:one', fixedTexts: ['测试消息'] }, confirmation);
  for (const [who, message] of [
    [{ ...scope, actorId: 'mate:two' }, spec],
    [{ ...scope, actorId: 'mate:one' }, { ...spec, account: 'another-account' }],
    [{ ...scope, actorId: 'mate:one' }, { ...spec, channel: 'another-channel' }],
    [{ ...scope, actorId: 'mate:one' }, { ...spec, recipients: ['recipient-one', 'outsider'] }],
    [{ ...scope, actorId: 'mate:one' }, { ...spec, category: 'offer' }],
    [{ ...scope, actorId: 'mate:one' }, { ...spec, content: ' 测试消息' }],
  ] as const) {
    assert.equal(grants.claim(who, call('denied'), { ...message, recipients: [...message.recipients] }), null);
  }
  assert.ok(grants.claim({ ...scope, actorId: 'mate:one' }, call('allowed'), spec));
});

test('One-time grant consumes once under concurrency; replaying same call skips exec', async () => {
  const grant = state.outboundGrants.create({ ...input, scope: { kind: 'once' } }, confirmation);
  const claims = await Promise.all(['call-one', 'call-two'].map(async (id) => grants.claim(scope, call(id), spec)));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(state.outboundGrants.get(grant.id)?.usedCount, 1);
  assert.equal(grants.claim(scope, call('call-one'), spec), null);
  assert.equal(state.outboundLog.list().length, 1);
});

test('Revoked, disabled, and expired grants fail immediately; edits check version', () => {
  const grant = state.outboundGrants.create(input, confirmation);
  state.outboundGrants.edit(grant.id, grant.version, { enabled: false }, confirmation);
  assert.equal(grants.claim(scope, call('paused'), spec), null);
  assert.throws(() => state.outboundGrants.edit(grant.id, grant.version, { enabled: true }, confirmation),
    { code: 'version_conflict' });
  const current = state.outboundGrants.get(grant.id)!;
  state.outboundGrants.edit(grant.id, current.version, { enabled: true,
    expiresAt: new Date(clock + 1).toISOString() }, confirmation);
  clock += 1;
  assert.equal(grants.claim(scope, call('expired'), spec), null);
  const fresh = state.outboundGrants.create(input, confirmation);
  state.outboundGrants.revoke(fresh.id, fresh.version, confirmation);
  assert.equal(grants.claim(scope, call('revoked'), spec), null);
});

test('Task grant binds to origin line; neither long nor single grant opens other actors', () => {
  const line = state.lines.create({ kind: 'background', title: '测试任务', parentLineId: MAIN_LINE_ID, projectId: null });
  state.outboundGrants.create({ ...input, scope: { kind: 'task', binding: { kind: 'line', id: line.id } } },
    confirmation);
  assert.equal(grants.claim({ ...scope, lineId: 'different-line' }, call('outside'), spec), null);
  assert.ok(grants.claim({ ...scope, lineId: line.id }, call('inside'), spec));
});

test('Task grant cannot bind permanent main line to turn temp grant into persistent', () => {
  assert.throws(() => state.outboundGrants.create({ ...input,
    scope: { kind: 'task', binding: { kind: 'line', id: MAIN_LINE_ID } } }, confirmation), { code: 'invalid_input' });
});

test('Every use logs raw text; failed or unverified execution never records as sent', () => {
  const grant = state.outboundGrants.create(input, confirmation);
  const first = grants.claim(scope, call('one'), spec)!;
  const second = grants.claim(scope, call('two'), spec)!;
  grants.finish(scope.lineId, 'one', { status: 'failed', summary: '对方拒收，没有发送。', sourceRef: null });
  grants.finish(scope.lineId, 'two', { status: 'unknown', summary: '连接中断，结果待核实。', sourceRef: null });
  assert.equal(state.outboundLog.get(first.log.id)?.status, 'failed');
  assert.equal(state.outboundLog.get(second.log.id)?.status, 'unknown');
  assert.equal(state.outboundLog.get(first.log.id)?.content, spec.content);
  assert.equal(state.outboundGrants.get(grant.id)?.usedCount, 2);
});

test('Unreceipted approval after restart becomes unverified; same call never re-runs', () => {
  state.outboundGrants.create(input, confirmation);
  const first = grants.claim(scope, call('interrupted'), spec)!;
  assert.equal(state.outboundLog.recoverPending(), 1);
  assert.equal(state.outboundLog.get(first.log.id)?.status, 'unknown');
  assert.equal(grants.claim(scope, call('interrupted'), spec), null);
});
