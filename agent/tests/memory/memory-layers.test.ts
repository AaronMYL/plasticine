// 记忆分层（11-15 Aaron 定）：三样新的各有固定位置——承诺和授权、主动告诉你各一份分了段的文档，做事经验按篇；
// 只有做事经验允许 Plasticine 自己写（依据 tried）；每轮上下文都带承诺和授权、主动告诉你。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { GRANTS_DOC_ID, PROACTIVE_DOC_ID, YOU_DOC_ID, memorySectionIn,
  memorySectionsOf } from '../../shared/state.ts';
import { moveLine } from '../../src/memory/curation/memory-cleanup.ts';
import { planCuration, type CurationSource } from '../../src/memory/curation/memory-curation-ops.ts';
import { snapshot } from '../../src/memory/curation/memory-curation-work.ts';
import { noteExperience } from '../../src/memory/docs/experience.ts';
import { addLine, ensureMemoryDocs } from '../../src/memory/docs/memory-doc-writes.ts';
import { grantsDocSection, memoryDocsSection,
  proactiveDocSection } from '../../src/memory/docs/memory-docs-context.ts';
import type { StateService } from '../../src/state/index.ts';
import { memoryState } from '../tools/helpers.ts';

let state: StateService;
const writer = { actor: 'brain' as const, ref: 'line:work-1' };
const user = { actor: 'user' as const, ref: 'device-1' };
const anchors = [{ kind: 'message' as const, ref: 'msg-1' }];
const sources = new Map<string, CurationSource>([['msg-1', { anchors, stated: true }]]);

beforeEach(() => {
  state = memoryState();
  ensureMemoryDocs(state);
});

afterEach(() => {
  state.close();
});

test('承诺和授权、主动告诉你各只有一份，一直在；每种文档有自己的几段', () => {
  ensureMemoryDocs(state);
  const kinds = state.memoryDocs.docs.live().map((doc) => doc.kind).sort();
  assert.deepEqual(kinds.filter((kind) => kind === 'grants' || kind === 'proactive'), ['grants', 'proactive']);
  assert.equal(state.memoryDocs.docs.require(GRANTS_DOC_ID).title, '承诺和授权');
  assert.equal(state.memoryDocs.docs.require(PROACTIVE_DOC_ID).title, '主动告诉你');
  assert.deepEqual(memorySectionsOf('grants'), ['allow', 'ask', 'hold', 'promise']);
  assert.deepEqual(memorySectionsOf('proactive'), ['never', 'when', 'style']);
  assert.deepEqual(memorySectionsOf('how'), ['do', 'avoid']);
  assert.deepEqual(memorySectionsOf('you'), ['note']);
  assert.equal(memorySectionIn('grants', 'note'), 'allow', '那边没有这一段就进第一段');
  assert.equal(memorySectionIn('grants', 'hold'), 'hold');
});

test('加一行时没写段进这种文档的第一段；写了这种文档没有的段不收', () => {
  const allowed = addLine(state, { docId: GRANTS_DOC_ID, text: '定时任务可以自己加，加完告诉他', basis: 'stated',
    anchors }, user);
  assert.equal(allowed.section, 'allow');
  const quiet = addLine(state, { docId: PROACTIVE_DOC_ID, section: 'when', text: '开会的时候不打扰',
    basis: 'stated', anchors }, user);
  assert.equal(quiet.section, 'when');
  assert.throws(() => addLine(state, { docId: YOU_DOC_ID, section: 'allow', text: '住在杭州', basis: 'stated',
    anchors }, user), /没有/);
});

test('整理按文档种类校验段：承诺和授权收 ask，关于你不收；没写段的进第一段；能新建做事经验文档', () => {
  const plan = planCuration({ ops: [
    { op: 'add', doc: GRANTS_DOC_ID, section: 'ask', text: '改线上数据之前先问', sources: ['msg-1'] },
    { op: 'add', doc: PROACTIVE_DOC_ID, text: '周末不提工作上的事', sources: ['msg-1'] },
    { op: 'add', doc: YOU_DOC_ID, section: 'ask', text: '住在杭州', sources: ['msg-1'] },
    { op: 'add', doc: YOU_DOC_ID, section: 'decision', text: '先做 15 天', sources: ['msg-1'] },
    { op: 'new_doc', ref: 'mail', kind: 'how', title: '发邮件', summary: '发邮件的做法；发之前读' },
    { op: 'add', doc: 'mail', section: 'do', text: '发之前先把草稿给他看', sources: ['msg-1'] },
  ] }, snapshot(state, sources));
  const added = plan.ops.filter((op) => op.kind === 'add');
  assert.deepEqual(added.map((op) => op.kind === 'add' ? op.section : ''), ['ask', 'never', 'do']);
  assert.equal(plan.ops.some((op) => op.kind === 'new_doc' && op.docKind === 'how'), true);
  assert.deepEqual(plan.rejected.map((item) => item.reason), ['这种文档里没有段 ask', '决定段只在项目文档里']);
});

test('做事经验：Plasticine 自己试出来的直接记成一行，带出处（哪条线）；重复不记，像密钥不记', () => {
  const first = noteExperience(state, { topic: '小红书', section: 'do', lineId: 'work-1',
    text: '链接要带着 xsec_token 才打得开' }, writer);
  assert.equal(first.saved, true);
  assert.ok(first.saved);
  assert.equal(first.created, true);
  assert.equal(first.doc.kind, 'how');
  assert.equal(first.line.basis, 'tried');
  assert.equal(first.line.section, 'do');
  assert.deepEqual(first.line.anchors, [{ kind: 'work', ref: 'line:work-1' }]);
  const again = noteExperience(state, { topic: ' 小红书 ', section: 'do', lineId: 'work-2',
    text: '链接要带着 xsec_token 才打得开。' }, writer);
  assert.deepEqual(again, { saved: false, reason: '这条已经记过' });
  const avoid = noteExperience(state, { topic: '小红书', section: 'avoid', lineId: 'work-2',
    text: '连着打开超过 50 篇会弹验证' }, writer);
  assert.ok(avoid.saved);
  assert.equal(avoid.created, false, '同一个网站记在同一篇里');
  assert.equal(avoid.doc.id, first.doc.id);
  const secret = noteExperience(state, { topic: '服务器', section: 'do', lineId: 'work-2',
    text: `令牌是 ghp_${'a'.repeat(36)}` }, writer);
  assert.deepEqual(secret, { saved: false, reason: '像密钥，不记' });
  assert.equal(state.memoryDocs.docs.live().filter((doc) => doc.kind === 'how').length, 1);
});

test('做事经验：后来的结果改那一行，旧说法留作「之前」，还是 Plasticine 试出来的', () => {
  const old = noteExperience(state, { topic: '小红书', section: 'avoid', lineId: 'work-1',
    text: '连着打开超过 50 篇会弹验证' }, writer);
  assert.ok(old.saved);
  const next = noteExperience(state, { topic: '小红书', section: 'avoid', lineId: 'work-3',
    text: '连着打开超过 30 篇会弹验证', replacesLineId: old.line.id }, writer);
  assert.ok(next.saved);
  assert.equal(next.line.previous, '连着打开超过 50 篇会弹验证');
  assert.equal(next.line.basis, 'tried');
  assert.deepEqual(next.line.anchors.map((anchor) => anchor.ref), ['line:work-1', 'line:work-3']);
  assert.equal(state.memoryDocs.lines.live(old.doc.id).length, 1);
  const wrong = noteExperience(state, { topic: '发邮件', section: 'do', lineId: 'work-3', text: '先存草稿',
    replacesLineId: next.line.id }, writer);
  assert.deepEqual(wrong, { saved: false, reason: '要改的那一行不在这一篇在用的行里' });
});

test('只有做事经验能记 Plasticine 自己试出来的：别的层不收，也挪不出去', () => {
  assert.throws(() => addLine(state, { docId: YOU_DOC_ID, text: '他大概喜欢早起', basis: 'tried',
    anchors: [{ kind: 'work', ref: 'line:work-1' }] }, writer), /只能记在做事经验里/);
  const tried = noteExperience(state, { topic: '发邮件', section: 'do', lineId: 'work-1', text: '附件超过 20M 先传网盘' },
    writer);
  assert.ok(tried.saved);
  assert.throws(() => moveLine(state, tried.line, YOU_DOC_ID, user), /只能留在做事经验里/);
});

test('挪一行：挪到另一种文档时落在那边有的段；同一份里换段（先停着、恢复）旧行进归档', () => {
  const said = addLine(state, { docId: YOU_DOC_ID, text: '周末不提工作上的事', basis: 'stated', anchors }, user);
  const moved = moveLine(state, said, PROACTIVE_DOC_ID, user);
  assert.equal(moved.docId, PROACTIVE_DOC_ID);
  assert.equal(moved.section, 'never', '关于你的 note 那边没有，进主动告诉你的第一段');
  assert.deepEqual(moved.anchors, anchors, '出处不变');
  const allowed = addLine(state, { docId: GRANTS_DOC_ID, text: '每周回顾可以自己发', basis: 'stated', anchors }, user);
  const held = moveLine(state, allowed, GRANTS_DOC_ID, user, 'hold');
  assert.equal(held.section, 'hold');
  assert.deepEqual(state.memoryDocs.lines.live(GRANTS_DOC_ID).map((line) => line.id), [held.id]);
  assert.equal(state.memoryDocs.lines.archived(GRANTS_DOC_ID).length, 1);
  const back = moveLine(state, held, GRANTS_DOC_ID, user, 'allow');
  assert.equal(back.section, 'allow');
  assert.throws(() => moveLine(state, back, GRANTS_DOC_ID, user, 'never'), /没有/);
});

test('每轮上下文带承诺和授权、主动告诉你整份（按段），没有行时不占；做事经验按篇列在目录里', () => {
  assert.equal(grantsDocSection(state), '');
  assert.equal(proactiveDocSection(state), '');
  const allow = addLine(state, { docId: GRANTS_DOC_ID, section: 'allow', text: '定时任务可以自己加，加完告诉他',
    basis: 'stated', anchors }, user);
  const ask = addLine(state, { docId: GRANTS_DOC_ID, section: 'ask', text: '改线上数据之前先问', basis: 'stated',
    anchors }, user);
  addLine(state, { docId: PROACTIVE_DOC_ID, section: 'never', text: '周末不提工作上的事', basis: 'stated',
    anchors }, user);
  const grants = grantsDocSection(state);
  assert.match(grants, /^## 承诺和授权/);
  assert.ok(grants.indexOf('### 可以直接做') < grants.indexOf('### 先问你'));
  assert.match(grants, new RegExp(`\\[行:${allow.id}\\] 定时任务可以自己加`));
  assert.match(grants, new RegExp(`\\[行:${ask.id}\\] 改线上数据之前先问`));
  assert.doesNotMatch(grants, /### 先停着/, '没有行的段不出现');
  assert.match(proactiveDocSection(state), /### 别提的\n- \[行:[^\]]+\] 周末不提工作上的事/);
  noteExperience(state, { topic: '小红书', section: 'do', lineId: 'work-1', text: '链接要带着 xsec_token 才打得开',
    summary: '打开链接、读正文、存进资料库；动手之前读' }, writer);
  const directory = memoryDocsSection(state);
  assert.match(directory, /做事经验（开工前先读相关的那一篇）：\n- 小红书：打开链接、读正文、存进资料库；动手之前读/);
  assert.doesNotMatch(directory, /承诺和授权|主动告诉你/, '整份带着的两页不在目录里重复列');
});
