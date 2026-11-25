import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemoryDoc, MemoryInference, MemoryLine } from '../../shared/state.ts';
import {
  looksLikeSecret,
  MAX_OPS,
  planCuration,
  sameThing,
  type CurationOp,
  type CurationSnapshot,
  type CurationSource,
} from '../../src/memory/curation/memory-curation-ops.ts';

const AT = '2026-11-02T08:00:00.000Z';

function doc(id: string, kind: MemoryDoc['kind'], title: string): MemoryDoc {
  return { id, kind, title, summary: '', projectId: kind === 'project' ? `p-${id}` : null, charLimit: 4_000,
    createdBy: 'system', retiredAt: null, createdAt: AT, updatedAt: AT, version: 1, migratedDefault: false,
    legacyPayload: null };
}

function line(id: string, docId: string, text: string): MemoryLine {
  return { id, docId, section: 'note', text, basis: 'stated', anchors: [{ kind: 'message', ref: 'old-msg' }],
    previous: null, supersedes: [], inferenceId: null, position: 0, writtenBy: 'brain', writtenRef: null,
    retiredAt: null, retiredReason: null, archivedAt: null, deletedAt: null, createdAt: AT, updatedAt: AT, version: 1,
    migratedDefault: false, legacyPayload: null, scopeKind: 'all', scopeRef: null };
}

function pending(docId: string, text: string): MemoryInference {
  return { id: `inf-${text}`, docId, section: 'note', text, why: '', anchors: [{ kind: 'message', ref: 'old-msg' }],
    jobId: null, status: 'pending', decidedAt: null, lineId: null, confirmedByDeviceId: null,
    confirmedByDeviceAt: null, createdAt: AT, updatedAt: AT, version: 1 };
}

const said: CurationSource = { anchors: [{ kind: 'message', ref: 'msg-1' }], stated: true };
const guessed: CurationSource = { anchors: [{ kind: 'memory_entry', ref: 'entry-2' }], stated: false };

function world(extra: Partial<CurationSnapshot> = {}): CurationSnapshot {
  return {
    docs: [doc('you', 'you', '关于你'), doc('ch', 'project', 'Cyber Hunter'), doc('tt', 'person', '许小雨')],
    lines: [line('l-home', 'you', '住在杭州'), line('l-job', 'you', '在学吉他，报了一个周末班')],
    pending: [pending('you', '偏好晚上工作')],
    sources: new Map([['msg-1', said], ['entry-2', guessed]]),
    ...extra,
  };
}

function plan(ops: CurationOp[], used: string[] = [], snapshot = world()) {
  return planCuration({ ops, used }, snapshot);
}

test('User-stated claim must cite real user message; missing or forged source rejected', () => {
  const result = plan([
    { op: 'add', doc: 'you', text: '养了一只猫' },
    { op: 'add', doc: 'you', text: '养了一只猫', sources: ['msg-404'] },
    { op: 'add', doc: 'you', text: '养了一只猫', sources: ['msg-1'] },
  ]);
  assert.deepEqual(result.rejected.map((item) => item.reason), ['没有引用来源', '来源 msg-404 不是这一次的用户原话']);
  assert.equal(result.ops.length, 1);
  assert.deepEqual(result.ops[0], { kind: 'add', doc: { id: 'you' }, section: 'note', text: '养了一只猫',
    anchors: [{ kind: 'message', ref: 'msg-1' }] });
});

test('Inferred source allowed in uncertain list only; rejected for direct line add', () => {
  const result = plan([
    { op: 'add', doc: 'you', text: '喜欢安静的地方', sources: ['entry-2'] },
    { op: 'infer', doc: 'you', text: '喜欢安静的地方', why: '旧版的推测', sources: ['entry-2'] },
  ]);
  assert.match(result.rejected[0]?.reason ?? '', /推测/);
  assert.equal(result.ops[0]?.kind, 'infer');
});

test('Duplicate active line rejected and logs user restatement once per consolidation', () => {
  const result = plan([
    { op: 'add', doc: 'you', text: '住在杭州。', sources: ['msg-1'] },
    { op: 'restated', line: 'l-home', sources: ['msg-1'] },
    { op: 'revise', line: 'l-job', text: '在学吉他，报了一个周末班', sources: ['msg-1'] },
  ]);
  assert.deepEqual(result.rejected.map((item) => item.reason),
    ['已经记过（算一次用户重说）', '和原来一样（算一次用户重说）']);
  assert.deepEqual(result.ops.map((op) => op.kind === 'restated' ? op.line.id : op.kind), ['l-home', 'l-job']);
});

test('Duplicate uncertain inference skipped; identical pair in same batch keeps first', () => {
  const result = plan([
    { op: 'infer', doc: 'you', text: '偏好晚上工作', why: '又是深夜', sources: ['msg-1'] },
    { op: 'infer', doc: 'tt', text: '小雨在试用 Plasticine', why: '提过', sources: ['msg-1'] },
    { op: 'infer', doc: 'tt', text: '小雨在试用 Plasticine！', why: '又提', sources: ['msg-1'] },
  ]);
  assert.equal(result.ops.length, 1);
  assert.equal(result.rejected.length, 2);
});

test('Line edit takes new text and source; one edit/retire per run; forgot marks flag', () => {
  const result = plan([
    { op: 'revise', line: 'l-home', text: '搬到了重庆', sources: ['msg-1'] },
    { op: 'retire', line: 'l-home', sources: ['msg-1'] },
    { op: 'retire', line: 'l-job', forget: true, sources: ['msg-1'] },
    { op: 'revise', line: 'l-gone', text: '没有这一行', sources: ['msg-1'] },
  ]);
  assert.deepEqual(result.ops.map((op) => op.kind), ['revise', 'retire']);
  const retire = result.ops[1];
  assert.equal(retire?.kind === 'retire' ? retire.reason : null, 'forgotten');
  assert.deepEqual(result.rejected.map((item) => item.reason),
    ['这一行这次已经改过或退休过', '没有在用的行 l-gone']);
});

test('New doc allows person/topic/skill/experience; merges same name; ref links lines', () => {
  const result = plan([
    { op: 'new_doc', ref: 'xc', kind: 'person', title: '赵一舟', summary: '用户的朋友' },
    { op: 'add', doc: 'xc', text: '赵一舟可能一起做阳台花园', sources: ['msg-1'] },
    { op: 'new_doc', ref: 'tt2', kind: 'person', title: '许小雨', summary: '邻居' },
    { op: 'add', doc: 'tt2', text: '小雨住在隔壁', sources: ['msg-1'] },
    { op: 'new_doc', ref: 'p', kind: 'project', title: '新项目', summary: '' },
  ]);
  assert.deepEqual(result.ops.map((op) => op.kind), ['new_doc', 'add', 'add']);
  const [, toNew, toExisting] = result.ops;
  assert.deepEqual(toNew?.kind === 'add' ? toNew.doc : null, { ref: 'xc' });
  assert.deepEqual(toExisting?.kind === 'add' ? toExisting.doc : null, { id: 'tt' });
  assert.match(result.rejected[0]?.reason ?? '', /只能新建人物、话题、技能或做事经验/);
});

test('Decisions section limited to project docs; rejects empty, huge, or secret text', () => {
  const secret = `sk-${'a'.repeat(40)}`;
  const result = plan([
    { op: 'add', doc: 'ch', section: 'decision', text: '先做 15 天 All-in', sources: ['msg-1'] },
    { op: 'add', doc: 'you', section: 'decision', text: '不是项目的决定', sources: ['msg-1'] },
    { op: 'add', doc: 'you', text: '长'.repeat(501), sources: ['msg-1'] },
    { op: 'add', doc: 'you', text: '  ', sources: ['msg-1'] },
    { op: 'add', doc: 'you', text: `密钥是 ${secret}`, sources: ['msg-1'] },
    { op: 'summary', doc: 'you', summary: '说'.repeat(151) },
  ]);
  assert.equal(result.ops.length, 1);
  assert.deepEqual(result.rejected.map((item) => item.reason),
    ['决定段只在项目文档里', '超过 500 字', '没有文字', '像密钥，不记', '超过 150 字']);
  assert.equal(looksLikeSecret(secret), true);
  assert.equal(looksLikeSecret('sk 开头的普通词'), false);
});

test('Reply-used lines count active IDs once each, capped at 40 ops per pass', () => {
  const many: CurationOp[] = Array.from({ length: MAX_OPS + 2 }, (_, index) =>
    ({ op: 'add', doc: 'you', text: `第 ${index} 件不同的事：${'甲乙丙丁戊己庚辛'.slice(index % 8)}${index}`,
      sources: ['msg-1'] }));
  const result = plan(many, ['l-home', 'l-home', 'l-404']);
  assert.deepEqual(result.used, ['l-home']);
  assert.equal(result.rejected.filter((item) => item.reason.includes('最多')).length, 2);
});

test('Same-fact check matches stripped equality or high bigram overlap, not antonyms', () => {
  assert.equal(sameThing('住在杭州', '住在杭州。'), true);
  assert.equal(sameThing('住在 杭州', '住在杭州'), true);
  assert.equal(sameThing('住在杭州', '搬去重庆了'), false);
});
