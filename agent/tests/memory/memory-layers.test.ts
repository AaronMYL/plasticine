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

test('Commitments/grants and proactive docs are singletons; each doc type has sections', () => {
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

test('Adding line without section defaults to first; invalid section for type rejected', () => {
  const allowed = addLine(state, { docId: GRANTS_DOC_ID, text: '定时任务可以自己加，加完告诉他', basis: 'stated',
    anchors }, user);
  assert.equal(allowed.section, 'allow');
  const quiet = addLine(state, { docId: PROACTIVE_DOC_ID, section: 'when', text: '开会的时候不打扰',
    basis: 'stated', anchors }, user);
  assert.equal(quiet.section, 'when');
  assert.throws(() => addLine(state, { docId: YOU_DOC_ID, section: 'allow', text: '住在杭州', basis: 'stated',
    anchors }, user), /没有/);
});

test('Consolidation validates sections per doc type and allows creating experience docs', () => {
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

test('Experience records Plasticine\'s own trials with line source; skips dupes/secrets', () => {
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

test('Later experience result updates line, archiving old text while keeping trial flag', () => {
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

test('Only experience layer accepts Plasticine-tried lines and prevents moving them out', () => {
  assert.throws(() => addLine(state, { docId: YOU_DOC_ID, text: '他大概喜欢早起', basis: 'tried',
    anchors: [{ kind: 'work', ref: 'line:work-1' }] }, writer), /只能记在做事经验里/);
  const tried = noteExperience(state, { topic: '发邮件', section: 'do', lineId: 'work-1', text: '附件超过 20M 先传网盘' },
    writer);
  assert.ok(tried.saved);
  assert.throws(() => moveLine(state, tried.line, YOU_DOC_ID, user), /只能留在做事经验里/);
});

test('Moving line maps to target doc section; same-doc section switch archives old line', () => {
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

test('Context loads commitments and proactive docs if non-empty; experience in catalog', () => {
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
