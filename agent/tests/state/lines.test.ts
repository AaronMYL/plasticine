import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { openTestState, type TestState } from './helpers.ts';

const opened: TestState[] = [];

async function fresh(): Promise<TestState> {
  const handle = await openTestState();
  opened.push(handle);
  return handle;
}

afterEach(async () => {
  for (const handle of opened.splice(0)) {
    await handle.cleanup();
  }
});

test('主对话那条线只有一条：第一次读时建出来，再读是同一条', async () => {
  const { state } = await fresh();
  const first = state.lines.main();
  assert.equal(first.id, MAIN_LINE_ID);
  assert.equal(first.kind, 'main');
  assert.equal(first.status, 'idle');
  assert.equal(state.lines.main().id, first.id);
  assert.equal(state.lines.list().length, 1);
});

test('线里的消息按 seq 递增追加，原样 JSON 读回；分页从新往旧取一页、页内从旧到新', async () => {
  const { state } = await fresh();
  const line = state.lines.main();
  for (let index = 1; index <= 5; index += 1) {
    state.lineMessages.append(line.id, 'user', { role: 'user', content: `第 ${index} 句：中文和 https://a.test/路径`,
      timestamp: index });
  }
  const page = state.lineMessages.page(line.id, null, 2);
  assert.deepEqual(page.rows.map((row) => row.seq), [4, 5]);
  assert.equal(page.hasMore, true);
  const older = state.lineMessages.page(line.id, 4, 10);
  assert.deepEqual(older.rows.map((row) => row.seq), [1, 2, 3]);
  assert.equal(older.hasMore, false);
  assert.deepEqual(state.lineMessages.after(line.id, 3).map((row) => row.seq), [4, 5]);
  assert.deepEqual(state.lineMessages.last(line.id)?.message,
    { role: 'user', content: '第 5 句：中文和 https://a.test/路径', timestamp: 5 });
});

test('排队的消息：先来的在前；发出记下 seq，撤回只改状态', async () => {
  const { state } = await fresh();
  const line = state.lines.main();
  const first = state.lineQueue.add(line.id, '再看看它有没有开机自启', []);
  const second = state.lineQueue.add(line.id, '顺便看签名', ['att-1']);
  assert.deepEqual(state.lineQueue.queued(line.id).map((row) => row.id), [first.id, second.id]);
  assert.deepEqual(state.lineQueue.linesWithQueued(), [line.id]);
  state.lineQueue.sent(first.id, 7);
  state.lineQueue.withdraw(second.id);
  assert.deepEqual(state.lineQueue.queued(line.id), []);
  assert.equal(state.lineQueue.get(first.id)?.sentSeq, 7);
  assert.equal(state.lineQueue.get(second.id)?.status, 'withdrawn');
  assert.deepEqual(state.lineQueue.get(second.id)?.attachments, ['att-1']);
});

test('后台线记谁开的它，按状态筛；改状态只改给的字段', async () => {
  const { state } = await fresh();
  const main = state.lines.main();
  const child = state.lines.create({ kind: 'background', parentLineId: main.id, projectId: null, title: '查来源' });
  state.lines.update(child.id, { status: 'paused', pausedUntil: '2026-10-27T13:00:00.000Z', failure: '额度用完' });
  const paused = state.lines.withStatus(['paused']);
  assert.deepEqual(paused.map((row) => row.id), [child.id]);
  assert.equal(paused[0]?.parentLineId, main.id);
  const resumed = state.lines.update(child.id, { status: 'running', pausedUntil: null });
  assert.equal(resumed.failure, '额度用完');
  assert.equal(resumed.pausedUntil, null);
  assert.deepEqual(state.lines.list({ parentLineId: main.id }).map((row) => row.id), [child.id]);
});

test('一次性批准：同意后只有第一次放行改得成', async () => {
  const { state } = await fresh();
  const line = state.lines.main();
  const ask = state.asks.create({ kind: 'approve', purpose: 'device_action', channel: 'popup', question: '发出？',
    detail: null, options: [], taskId: null, runId: null, actionId: null, context: null });
  const approval = state.lineApprovals.create({ lineId: line.id, toolCallId: 'call-1', toolName: 'send_mail',
    argsDigest: 'd1', hardLine: 'outward', askId: ask.id });
  state.lineApprovals.setStatus(approval.id, 'approved', { from: 'pending' });
  assert.equal(state.lineApprovals.setStatus(approval.id, 'used', { from: 'approved' })?.status, 'used');
  assert.equal(state.lineApprovals.setStatus(approval.id, 'used', { from: 'approved' }), undefined);
  assert.equal(state.lineApprovals.forCall(line.id, 'call-1')?.status, 'used');
  assert.equal(state.lineApprovals.byAsk(ask.id)?.id, approval.id);
});

test('模型凭证：写入、列出不带凭证本身；退出登录置空不删行', async () => {
  const { state } = await fresh();
  state.kernelCredentials.write('deepseek', 'api_key', { type: 'api_key', key: 'test-key-not-real' });
  assert.deepEqual(state.kernelCredentials.list().map((row) => [row.providerId, row.type]), [['deepseek', 'api_key']]);
  assert.equal(JSON.stringify(state.kernelCredentials.list()).includes('test-key-not-real'), false);
  state.kernelCredentials.clear('deepseek');
  assert.equal(state.kernelCredentials.read('deepseek'), undefined);
  assert.deepEqual(state.kernelCredentials.list(), []);
  state.kernelSettings.set('device_id', '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  assert.equal(state.kernelSettings.get('device_id'), '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d');
  assert.equal(state.kernelSettings.get('missing'), undefined);
});
