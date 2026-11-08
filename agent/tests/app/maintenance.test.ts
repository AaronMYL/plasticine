// 第 115 条：长期维护入口。写操作要用户的原话、记进操作记录；同一个操作号重放只回原结果；规则改档位记 maintenance
// 事件；读操作不记。2026-11-05 任务删掉后，任务的批量操作随之删掉，status 改数线。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { MaintenanceFailure, performMaintenance, runMaintenance } from '../../src/app/maintenance.ts';
import { CloudToolError, type RefetchReport } from '../../src/cloud-tools/index.ts';
import { ensureIntake } from '../../src/intake/index.ts';
import { openState, type StateService } from '../../src/state/index.ts';

let h: { state: StateService };

beforeEach(() => {
  h = { state: openState({ path: ':memory:' }) };
  ensureIntake(h.state);
});

afterEach(() => {
  h.state.close();
});

const deps = () => ({ state: h.state });
const BECAUSE = '先把收录关掉（推荐）';

function failure(work: () => unknown): MaintenanceFailure {
  try {
    work();
  } catch (error) {
    assert.ok(error instanceof MaintenanceFailure, `应当抛 MaintenanceFailure，实际 ${String(error)}`);
    return error;
  }
  assert.fail('应当拒绝');
}

test('同一个操作号重放：不再动，回当时的结果；没有新事件', () => {
  const rule = h.state.rules.byCode('feed_interest')!;
  const request = { operationId: 'op-rule-1', op: 'rules.mode' as const, code: 'feed_interest', mode: 'auto' as const,
    because: BECAUSE };
  const first = runMaintenance(deps(), request);
  const events = h.state.rules.events(rule.id).length;
  const again = runMaintenance(deps(), request);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.result, first.result);
  assert.equal(h.state.rules.events(rule.id).length, events);
});

test('写操作没有原话、或原话是空白，一律拒绝，也不记操作', () => {
  const missing = failure(() => runMaintenance(deps(), { operationId: 'op-x', op: 'rules.mode', code: 'feed_interest',
    mode: 'auto' }));
  assert.equal(missing.code, 'because_required');
  failure(() => runMaintenance(deps(), { operationId: 'op-y', op: 'rules.mode', code: 'feed_interest', mode: 'auto',
    because: '  ' }));
  assert.equal(h.state.rules.byCode('feed_interest')?.mode, 'off');
  assert.equal(h.state.maintenanceOperations.get('op-x'), undefined);
});

test('规则改档位：改档，版本加一，记一条 maintenance 事件带原话；不认识的代号拒绝', () => {
  // 11-06 起这几条并进心跳，种成关；维护入口照样能改档。
  const before = h.state.rules.byCode('reply_needed')!;
  assert.equal(before.mode, 'off');
  runMaintenance(deps(), { operationId: 'op-rule', op: 'rules.mode', code: 'reply_needed', mode: 'observe',
    because: '先别自己回信' });
  const after = h.state.rules.byCode('reply_needed')!;
  assert.equal(after.mode, 'observe');
  assert.equal(after.version, before.version + 1);
  const event = h.state.rules.events(after.id).at(-1);
  assert.equal(event?.actor, 'maintenance');
  assert.equal(event?.fromMode, before.mode);
  assert.match(event?.reason ?? '', /先别自己回信/);
  const unknown = failure(() => runMaintenance(deps(), { operationId: 'op-rule-2', op: 'rules.mode',
    code: 'no_such_rule', mode: 'off', because: '关掉' }));
  assert.equal(unknown.code, 'not_found');
});

test('状态：按状态数线、列出规则档位、最近的维护操作', () => {
  h.state.lines.main();
  runMaintenance(deps(), { operationId: 'op-s', op: 'rules.mode', code: 'feed_interest', mode: 'auto', because: '开' });
  const status = runMaintenance(deps(), { operationId: 'op-status', op: 'status' }).result as {
    lines: Record<string, number>; rules: { code: string; mode: string }[]; recent: { id: string }[];
  };
  assert.equal(status.lines['idle'], 1);
  assert.ok(status.rules.some((rule) => rule.code === 'feed_interest' && rule.mode === 'auto'));
  assert.deepEqual(status.recent.map((row) => row.id), ['op-s']);
});

async function failsWith(work: () => Promise<unknown>, code: string): Promise<MaintenanceFailure> {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof MaintenanceFailure, `应当抛 MaintenanceFailure，实际 ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail('应当拒绝');
}

const REFETCH_QUOTE = '从 Gmail 重新抓回补齐格式，合并重复';
const REPORT: RefetchReport = { tried: 2, found: 1, notFound: 1, errors: 0, remaining: 0,
  items: [{ id: 'm1', outcome: 'found' }, { id: 'm2', outcome: 'not_found' }] };

test('mail.refetch：要原话；结果记进操作记录，同一个操作号重放不再连 Gmail；没给 --limit 补 30 封', async () => {
  const limits: number[] = [];
  const refetchDeps = { ...deps(), m5b: { cloud: { mailRefetch: { run: async (limit: number) => {
    limits.push(limit);
    return REPORT;
  } } } } };
  await failsWith(() => performMaintenance(refetchDeps, { operationId: 'op-mail-0', op: 'mail.refetch' }),
    'because_required');
  const first = await performMaintenance(refetchDeps, { operationId: 'op-mail-1', op: 'mail.refetch',
    because: REFETCH_QUOTE, limit: 5 });
  assert.equal(first.replayed, false);
  assert.deepEqual(first.result, REPORT);
  const again = await performMaintenance(refetchDeps, { operationId: 'op-mail-1', op: 'mail.refetch',
    because: REFETCH_QUOTE, limit: 5 });
  assert.equal(again.replayed, true);
  assert.deepEqual(again.result, REPORT);
  await performMaintenance(refetchDeps, { operationId: 'op-mail-2', op: 'mail.refetch', because: REFETCH_QUOTE });
  assert.deepEqual(limits, [5, 30]);
  const recorded = h.state.maintenanceOperations.get('op-mail-1');
  assert.equal(recorded?.because, REFETCH_QUOTE);
  assert.deepEqual(recorded?.args, { code: null, mode: null, limit: 5 });
});

test('mail.refetch：收信没接上或没装就说不能做（unavailable），不记操作；同步入口不收它', async () => {
  const refuse = { ...deps(), m5b: { cloud: { mailRefetch: { run: async (): Promise<RefetchReport> => {
    throw new CloudToolError('not_configured', '收信还没接上 Gmail，没法从 Gmail 重新抓。');
  } } } } };
  const failure = await failsWith(() => performMaintenance(refuse, { operationId: 'op-mail-3', op: 'mail.refetch',
    because: REFETCH_QUOTE }), 'unavailable');
  assert.match(failure.message, /还没接上 Gmail/);
  await failsWith(() => performMaintenance(deps(), { operationId: 'op-mail-4', op: 'mail.refetch',
    because: REFETCH_QUOTE }), 'unavailable');
  assert.equal(h.state.maintenanceOperations.get('op-mail-3'), undefined);
  assert.throws(() => runMaintenance(deps(), { operationId: 'op-mail-5', op: 'mail.refetch', because: REFETCH_QUOTE }),
    MaintenanceFailure);
  const status = await performMaintenance(deps(), { operationId: 'op-status-2', op: 'status' });
  assert.equal(status.op, 'status');
});
