// 第 115 条：长期维护入口。写操作要用户的原话、记进操作记录；同一个操作号重放只回原结果；规则改档位记 maintenance
// 事件；读操作不记。2026-11-05 任务删掉后，任务的批量操作随之删掉，status 改数线。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { MaintenanceFailure, performMaintenance, runMaintenance } from '../../src/app/maintenance.ts';
import { CloudToolError, type RefetchReport } from '../../src/cloud-tools/index.ts';
import { ensureIntake } from '../../src/intake/index.ts';
import { openState, type StateService } from '../../src/state/index.ts';
import { RULES_DOC_ID, YOU_DOC_ID } from '../../shared/state.ts';
import { addLine, ensureMemoryDocs } from '../../src/brain/memory-doc-writes.ts';

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
  assert.deepEqual(recorded?.args, { code: null, mode: null, limit: 5, plan: null });
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

test('整理规则：一行拆成几行，照抄来源和范围、存原文；过时的挪进归档；同一个操作号重放不再动', () => {
  ensureMemoryDocs(h.state);
  const old = addLine(h.state, { docId: RULES_DOC_ID, text: '- **先核实再回答。**\n- **邮件**：每天一封', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'msg-1' }] }, { actor: 'brain', ref: 'run' });
  const stale = addLine(h.state, { docId: RULES_DOC_ID, text: '对话内容会发给模型公司', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'msg-2' }] }, { actor: 'brain', ref: 'run' });
  const request = { operationId: 'op-rules-1', op: 'rules.rewrite' as const, because: '规则你帮我整理',
    plan: [{ lineId: old.id, version: old.version, into: [{ text: '先核实再回答。', section: 'doing' as const }] },
      { lineId: stale.id, version: stale.version, into: [] }] };
  const first = runMaintenance(deps(), request);
  assert.deepEqual(first.result, { rewritten: 1, retired: 1, added: 1 });
  const live = h.state.memoryDocs.lines.live(RULES_DOC_ID).filter((line) => line.supersedes.includes(old.id));
  assert.equal(live.length, 1);
  assert.equal(live[0]?.previous, old.text);
  assert.deepEqual(live[0]?.anchors, old.anchors);
  assert.equal(live[0]?.basis, 'stated');
  assert.notEqual(h.state.memoryDocs.lines.require(stale.id).archivedAt, null, '进归档，不是删除');
  assert.equal(runMaintenance(deps(), request).replayed, true);
  assert.equal(h.state.memoryDocs.lines.live(RULES_DOC_ID).filter((line) => line.supersedes.includes(old.id)).length, 1);
});

test('memory.move 把几行挪到别的文档；memory.cleanup.add 放进整理清单等勾选，不注明来处', () => {
  ensureMemoryDocs(h.state);
  const doc = h.state.memoryDocs.docs.create({ kind: 'topic', title: '生活', summary: '', createdBy: 'user' });
  const line = addLine(h.state, { docId: doc.id, text: '房租每月 5 号交', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'msg-1' }] }, { actor: 'brain', ref: 'run' });
  runMaintenance(deps(), { operationId: 'move-personal-1', op: 'memory.move', because: '直接挪好',
    moves: [{ lineId: line.id, version: line.version, toDocId: YOU_DOC_ID }] });
  assert.ok(h.state.memoryDocs.lines.live(YOU_DOC_ID).some((item) => item.text === '房租每月 5 号交'));
  assert.notEqual(h.state.memoryDocs.lines.require(line.id).archivedAt, null);
  runMaintenance(deps(), { operationId: 'claude-adds-1', op: 'memory.cleanup.add', because: '把你的记忆也整理进去',
    adds: [{ toDocId: YOU_DOC_ID, text: '住在成都。' }, { person: '林一', text: '邻居，常一起吃饭。' }] });
  const [item, person] = h.state.memoryCleanups.latest()?.items ?? [];
  assert.equal(item?.kind, 'add');
  assert.equal(item?.reason, '');
  const page = h.state.memoryDocs.docs.live().find((candidate) => candidate.kind === 'person'
    && candidate.title === '林一');
  assert.equal(person?.toDocId, page?.id);
});

test('suggestions.dismiss：把还摆着的几条建议收起，结果里记下原来的状态；处理过的不动；有一条找不到整批不动', () => {
  const make = (title: string) => h.state.suggestions.create({ title, why: '回顾里的一条', goal: title, projectId: null,
    source: 'review', icon: 'sparkle', key: `review:test:${title}`, sourceRef: null });
  const first = make('3．优先补读原文');
  const second = make('最后，把纠正变成场景');
  const started = make('已经开始做的');
  h.state.suggestions.update(started.id, started.version, { status: 'started', actedAt: new Date().toISOString(),
    actedByDeviceId: 'device-1' });
  const request = { operationId: 'op-suggest-1', op: 'suggestions.dismiss' as const, because: '「建议」里 13 条半句话收起',
    ids: [first.id, second.id, started.id] };
  const done = runMaintenance(deps(), request);
  assert.deepEqual(done.result, { dismissed: 2, skipped: 1, before: [
    { id: first.id, title: '3．优先补读原文', status: 'open' },
    { id: second.id, title: '最后，把纠正变成场景', status: 'open' },
    { id: started.id, title: '已经开始做的', status: 'started' }] });
  assert.equal(h.state.suggestions.get(first.id)?.status, 'dismissed');
  assert.equal(h.state.suggestions.get(first.id)?.actedByDeviceId, 'maintenance:op-suggest-1');
  assert.equal(h.state.suggestions.get(started.id)?.status, 'started');
  assert.equal(runMaintenance(deps(), request).replayed, true);
  const third = make('还摆着的一条');
  const missing = failure(() => runMaintenance(deps(), { operationId: 'op-suggest-2', op: 'suggestions.dismiss',
    because: '收起', ids: [third.id, 'no-such-id'] }));
  assert.match(missing.message, /没有这条建议/);
  assert.equal(h.state.suggestions.get(third.id)?.status, 'open');
  assert.match(failure(() => runMaintenance(deps(), { operationId: 'op-suggest-3', op: 'suggestions.dismiss',
    because: '收起' })).message, /--ids/);
});

test('inbox.archive：把巡查、反馈、采访留下的来信归档（不删），邮件不动；结果里记下归档了哪几封', () => {
  const add = (source: 'patrol' | 'feedback' | 'interview' | 'email', title: string) => h.state.inboxMessages.add({ source,
    fromAddress: source === 'email' ? 'lin@example.test' : 'plasticine', fromName: null, title, body: title,
    receivedAt: '2026-11-07T05:00:00.000Z', attachments: [] }).message;
  const patrol = add('patrol', '首页头条可以换成「等你」的事');
  const feedback = add('feedback', '按钮太小');
  const mail = add('email', '周五下午有空');
  const done = runMaintenance(deps(), { operationId: 'op-inbox-1', op: 'inbox.archive',
    because: '消息里「采访、巡查、反馈」三行归档', sources: ['patrol', 'feedback', 'interview'] });
  assert.deepEqual(done.result, { archived: 2, messages: [
    { id: patrol.id, source: 'patrol', title: '首页头条可以换成「等你」的事' },
    { id: feedback.id, source: 'feedback', title: '按钮太小' }] });
  assert.notEqual(h.state.inboxMessages.require(patrol.id).archivedAt, null);
  assert.equal(h.state.inboxMessages.require(mail.id).archivedAt, null);
  assert.equal(h.state.inboxMessages.count({ box: 'patrol' }), 0);
  assert.match(failure(() => runMaintenance(deps(), { operationId: 'op-inbox-2', op: 'inbox.archive',
    because: '归档' })).message, /--sources/);
});
