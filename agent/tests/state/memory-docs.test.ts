import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { YOU_DOC_ID, type MemoryInferenceConfirmed } from '../../shared/state.ts';
import { brainChange, device, forged, openTestState, throwsState, userSource, type TestState } from './helpers.ts';

let t: TestState;

beforeEach(async () => {
  t = await openTestState();
});

afterEach(async () => {
  await t.cleanup();
});

function youDoc() {
  return t.state.memoryDocs.docs.create({ kind: 'you', title: '关于你', summary: '用户本人：住处、工作。',
    createdBy: 'system' }, { id: YOU_DOC_ID });
}

const anchor = { kind: 'message' as const, ref: 'msg-1' };

test('新建文档和行：没写的取默认，行按加入的先后排位置', () => {
  const doc = youDoc();
  assert.equal(doc.charLimit, 4_000);
  assert.equal(doc.projectId, null);
  const first = t.state.memoryDocs.lines.add({ docId: doc.id, text: '住在杭州', basis: 'stated', anchors: [anchor],
    writtenBy: 'brain' });
  const second = t.state.memoryDocs.lines.add({ docId: doc.id, text: '在做 Cyber Hunter', basis: 'stated',
    anchors: [anchor], writtenBy: 'brain' });
  assert.equal(first.section, 'note');
  assert.deepEqual([first.position, second.position], [0, 1]);
  assert.deepEqual(t.state.memoryDocs.lines.size(doc.id), { lines: 2, chars: 4 + 15 });
});

test('一行至少一个锚点、不能超过 500 字；行除了退休不原地改', () => {
  const doc = youDoc();
  const base = { docId: doc.id, basis: 'stated' as const, writtenBy: 'brain' as const };
  throwsState(() => t.state.memoryDocs.lines.add({ ...base, text: '没有来源', anchors: [] }), 'invalid_input');
  throwsState(() => t.state.memoryDocs.lines.add({ ...base, text: '长'.repeat(501), anchors: [anchor] }),
    'invalid_input');
  const line = t.state.memoryDocs.lines.add({ ...base, text: '住在杭州', anchors: [anchor] });
  const retired = t.state.memoryDocs.lines.retire(line.id, line.version, 'revised');
  assert.equal(retired.retiredReason, 'revised');
  assert.deepEqual(t.state.memoryDocs.lines.live(doc.id), []);
  throwsState(() => t.state.memoryDocs.lines.retire(line.id, retired.version, 'forgotten'), 'version_conflict');
});

test('改一行：新行接旧行的位置，文档里还是那一行，旧行留着', () => {
  const doc = youDoc();
  const base = { docId: doc.id, basis: 'stated' as const, writtenBy: 'brain' as const, anchors: [anchor] };
  const old = t.state.memoryDocs.lines.add({ ...base, text: '住在杭州' });
  t.state.memoryDocs.lines.add({ ...base, text: '在做 Cyber Hunter' });
  t.state.memoryDocs.lines.retire(old.id, old.version, 'revised');
  const revised = t.state.memoryDocs.lines.add({ ...base, text: '搬到了重庆', previous: old.text,
    supersedes: [old.id], position: old.position });
  assert.deepEqual(t.state.memoryDocs.lines.live(doc.id).map((line) => line.text), ['搬到了重庆', '在做 Cyber Hunter']);
  assert.equal(revised.previous, '住在杭州');
  assert.equal(t.state.memoryDocs.lines.retired(doc.id)[0]?.id, old.id);
});

test('确认过的推断行：没有经设备确认的推断写不出来', () => {
  const doc = youDoc();
  const inference = t.state.memoryCuration.inferences.create({ docId: doc.id, text: '偏好晚上工作',
    why: '三次都在深夜发消息', anchors: [anchor] });
  assert.equal(inference.status, 'pending');
  const line = { docId: doc.id, text: '偏好晚上工作', basis: 'confirmed_inference' as const, anchors: [anchor],
    writtenBy: 'user' as const, inferenceId: inference.id };
  throwsState(() => t.state.memoryDocs.lines.add(line), 'confirmation_required');
  throwsState(() => t.state.memoryDocs.lines.add({ ...line, inferenceId: null }), 'confirmation_required');
  const confirmed: MemoryInferenceConfirmed = { status: 'confirmed', decidedAt: '2026-10-27T09:00:00.000Z' };
  const decided = t.state.memoryCuration.inferences.decide(inference.id, 1, confirmed, device(), '用户确认');
  assert.equal(decided.confirmedByDeviceId, 'iphone-1');
  assert.equal(t.state.memoryDocs.lines.add(line).basis, 'confirmed_inference');
});

test('推断的状态是用户确认字段：普通写入只能写 pending，改不了状态', () => {
  const doc = youDoc();
  const input = { docId: doc.id, text: '偏好晚上工作', why: '推测', anchors: [anchor] };
  throwsState(() => t.state.memoryCuration.inferences.create({ ...input, status: forged<'pending'>('confirmed') }),
    'confirmation_required');
  const inference = t.state.memoryCuration.inferences.create(input);
  throwsState(() => t.state.memoryCuration.inferences.update(inference.id, 1, forged({ status: 'rejected' })),
    'confirmation_required');
  const rejected: MemoryInferenceConfirmed = { status: 'rejected', decidedAt: '2026-10-27T09:00:00.000Z' };
  throwsState(() => t.state.memoryCuration.inferences.decide(inference.id, 1, rejected, forged(undefined), '否掉'),
    'confirmation_required');
  assert.equal(t.state.memoryCuration.inferences.count('pending'), 1);
});

test('系统可以撤回还没定的推断（不是用户否掉），也可以把它挪到另一份文档；用户定过的动不了', () => {
  const doc = youDoc();
  const topic = t.state.memoryDocs.docs.create({ kind: 'topic', title: '阅读兴趣', summary: '读什么',
    createdBy: 'migration' });
  const inferences = t.state.memoryCuration.inferences;
  const input = { docId: doc.id, text: '对大模型感兴趣', why: '旧阅读配置', anchors: [anchor] };
  const moved = inferences.move(inferences.create(input).id, 1, topic.id);
  assert.equal(moved.docId, topic.id);
  assert.equal(moved.status, 'pending');
  const withdrawn = inferences.withdraw(moved.id, moved.version);
  assert.equal(withdrawn.status, 'withdrawn');
  assert.equal(withdrawn.decidedAt, null);
  assert.equal(withdrawn.confirmedByDeviceId, null);
  assert.deepEqual(inferences.pendingForDoc(topic.id), []);
  assert.equal(inferences.count('withdrawn'), 1);
  throwsState(() => inferences.withdraw(withdrawn.id, withdrawn.version), 'version_conflict');
  throwsState(() => inferences.move(withdrawn.id, withdrawn.version, doc.id), 'version_conflict');
  const decided = inferences.decide(inferences.create(input).id, 1,
    { status: 'confirmed', decidedAt: '2026-10-27T09:00:00.000Z' }, device(), '用户确认');
  throwsState(() => inferences.withdraw(decided.id, decided.version), 'version_conflict');
  throwsState(() => inferences.update(decided.id, decided.version, { status: 'withdrawn' }), 'version_conflict');
  throwsState(() => inferences.update(decided.id, decided.version, { docId: topic.id }), 'version_conflict');
  throwsState(() => inferences.move(inferences.create(input).id, 1, 'memdoc-nope'), 'not_found');
});

test('事件按 detail 里的一个字段找：整理脚本用它判断这份清单是不是已经落过库', () => {
  const events = t.state.memoryDocs.events;
  events.add({ docId: null, lineId: null, kind: 'entries_migrated', actor: 'migration', actorRef: 'cur-1',
    detail: { curationId: 'cur-1', sha256: 'abc' } });
  events.add({ docId: null, lineId: null, kind: 'entries_migrated', actor: 'migration', actorRef: 'job-1',
    detail: { entryIds: ['e1'] } });
  assert.deepEqual(events.withDetail('entries_migrated', 'curationId', 'cur-1').map((event) => event.actorRef),
    ['cur-1']);
  assert.deepEqual(events.withDetail('entries_migrated', 'curationId', 'cur-2'), []);
  assert.deepEqual(events.withDetail('restated', 'curationId', 'cur-1'), []);
});

test('项目文档和项目一一对应：同一个项目第二份文档拒绝写入', () => {
  const project = t.state.projects.create({ name: 'Cyber Hunter' });
  const input = { kind: 'project' as const, title: 'Cyber Hunter', summary: '项目档案', projectId: project.id,
    createdBy: 'system' as const };
  const doc = t.state.memoryDocs.docs.create(input);
  assert.equal(t.state.memoryDocs.docs.forProject(project.id)?.id, doc.id);
  throwsState(() => t.state.memoryDocs.docs.create(input), 'duplicate');
});

test('作业队列：同一个 key 只排一次；先做对话轮的整理，再合并压缩，最后迁移批次', () => {
  const jobs = t.state.memoryCuration.jobs;
  jobs.enqueue({ key: 'migration:e1', kind: 'migration', sourceIds: ['e1'] });
  jobs.enqueue({ key: 'compact:d1:1', kind: 'compact', docId: 'd1', sourceIds: [] });
  const turn = jobs.enqueue({ key: 'turn:run-1', kind: 'turn', runId: 'run-1', sourceIds: ['msg-1'] });
  assert.equal(turn.created, true);
  assert.equal(jobs.enqueue({ key: 'turn:run-1', kind: 'turn', sourceIds: [] }).created, false);
  assert.equal(jobs.nextQueued()?.key, 'turn:run-1');
  jobs.update(turn.job.id, turn.job.version, { status: 'done' });
  assert.equal(jobs.nextQueued()?.key, 'compact:d1:1');
  assert.equal(jobs.openCompaction('d1')?.key, 'compact:d1:1');
  assert.equal(jobs.count('queued'), 2);
});

test('迁移进度：截止点只记一次；只列截止点前、还没有去向的旧条目；去向重复记不覆盖', () => {
  const sourceId = userSource(t.state);
  const make = (text: string) => t.state.memory.create({ text, kind: 'quote', basis: 'self_reported', sourceId,
    provenance: '对话' }, brainChange());
  const first = make('住在杭州');
  const second = make('在做 Cyber Hunter');
  const migration = t.state.memoryCuration.migration;
  assert.equal(migration.state(), undefined);
  const state = migration.start(second.createdAt);
  assert.equal(migration.start('2099-01-01T00:00:00.000Z').cutoff, state.cutoff);
  make('截止点之后才记的');
  assert.deepEqual(migration.pendingEntryIds(state.cutoff, 10), [first.id, second.id]);
  migration.record({ entryId: first.id, jobId: 'job-1', outcome: 'line', targetId: 'line-1', note: '' });
  migration.record({ entryId: first.id, jobId: 'job-2', outcome: 'skipped', targetId: null, note: '重跑' });
  assert.equal(migration.find(first.id)?.outcome, 'line');
  assert.deepEqual(migration.progress(state.cutoff), { total: 2, pending: 1 });
  assert.equal(migration.finished(), false);
  migration.finish();
  assert.equal(migration.finished(), true);
});

test('度量事件：按种类和时间计数，回复用到的行按行数加起来', () => {
  const events = t.state.memoryDocs.events;
  events.add({ docId: YOU_DOC_ID, lineId: 'l1', kind: 'restated', actor: 'brain', actorRef: 'job-1',
    detail: { messageId: 'msg-2' } });
  events.add({ docId: null, lineId: null, kind: 'lines_used', actor: 'brain', actorRef: 'job-1',
    detail: { lineIds: ['l1', 'l2'] } });
  events.add({ docId: null, lineId: null, kind: 'lines_used', actor: 'brain', actorRef: 'job-2',
    detail: { lineIds: ['l1'] } });
  assert.equal(events.count('restated', '2026-01-01T00:00:00.000Z'), 1);
  assert.equal(events.usedLines('2026-01-01T00:00:00.000Z'), 3);
  assert.equal(events.usedLines('2099-01-01T00:00:00.000Z'), 0);
});
