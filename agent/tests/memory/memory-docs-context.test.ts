import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { RULES_DOC_ID, YOU_DOC_ID } from '../../shared/state.ts';
import { addLine, ensureMemoryDocs, ensureProjectDoc } from '../../src/memory/docs/memory-doc-writes.ts';
import { findDoc, memoryDocsSection, rulesDocSection, searchMemory, todaySection, TODAY_BUDGET_TOKENS,
  YOU_DOC_BUDGET_TOKENS } from '../../src/memory/docs/memory-docs-context.ts';
import type { StateService } from '../../src/state/index.ts';
import { memoryState } from '../tools/helpers.ts';

let state: StateService;
const writer = { actor: 'brain' as const, ref: 'job-1' };
const anchors = [{ kind: 'message' as const, ref: 'msg-1' }];

beforeEach(() => {
  state = memoryState();
});

afterEach(() => {
  state.close();
});

test('Each request includes generated catalog and About You, omitting empty/done docs', () => {
  const live = state.projects.create({ name: 'Cyber Hunter' });
  const empty = state.projects.create({ name: '还没内容的项目' });
  const done = state.projects.create({ name: '旧项目', lifecycle: 'done' });
  assert.equal(memoryDocsSection(state), '', '一行都还没有时不占上下文');
  ensureMemoryDocs(state);
  for (const project of [live, done]) {
    addLine(state, { docId: ensureProjectDoc(state, project).id, section: 'decision', text: '先做 15 天 All-in',
      basis: 'stated', anchors }, writer);
  }
  const home = addLine(state, { docId: YOU_DOC_ID, text: '住在杭州', basis: 'stated', anchors }, writer);
  const person = state.memoryDocs.docs.create({ kind: 'person', title: '小林', summary: '大学同学；聊到独立游戏时读',
    createdBy: 'brain' });
  addLine(state, { docId: person.id, text: '在做独立游戏', basis: 'stated', anchors }, writer);
  const section = memoryDocsSection(state);
  assert.match(section, /^## 记忆/);
  assert.match(section, /### 目录\n关于你和做事方式：\n- 关于你：身份、住处、作息和长期偏好\n- 规则：[^\n]+\n项目：\n/);
  assert.match(section, /项目：\n- Cyber Hunter：定下的方向、决定、约束和进展；聊到「Cyber Hunter」时读\n人：\n- 小林：大学同学/);
  assert.doesNotMatch(section, /memdoc-project/, '目录里写名字，不写标识');
  assert.doesNotMatch(section, /旧项目/);
  assert.doesNotMatch(section, new RegExp(empty.name));
  assert.match(section, new RegExp(`### 关于你\\n- \\[行:${home.id}\\] 住在杭州`));
});

test('About You over budget loads fitting lines and notes remaining omitted count', () => {
  ensureMemoryDocs(state);
  const long = '这是一行比较长的关于用户本人的事实，'.repeat(12);
  for (let index = 0; index < 20; index += 1) {
    addLine(state, { docId: YOU_DOC_ID, text: `${index}：${long}`, basis: 'stated', anchors }, writer);
  }
  const section = memoryDocsSection(state);
  const shown = section.split('\n').filter((line) => line.startsWith('- [行:')).length;
  assert.ok(shown > 0 && shown < 20, `装了 ${shown} 行`);
  assert.match(section, new RegExp(`关于你还有 ${20 - shown} 行这次没装`));
  assert.ok(YOU_DOC_BUDGET_TOKENS < 20 * long.length);
});

test('Main Soul loads in full with hard lines first and no truncation even when empty', () => {
  ensureMemoryDocs(state);
  for (const line of state.memoryDocs.lines.live(RULES_DOC_ID)) {
    state.memoryDocs.lines.retire(line.id, line.version, 'no_longer_true');
  }
  const empty = rulesDocSection(state);
  assert.match(empty, /^## 规则/);
  assert.match(empty, /花钱/);
  assert.match(empty, /以本人名义对外答应或发出/);
  assert.doesNotMatch(empty, /\[行:/);
  const long = '这是一条比较长的做事规矩，'.repeat(30);
  const lines = Array.from({ length: 12 }, (_, index) => addLine(state, { docId: RULES_DOC_ID,
    text: `${index}：${long}`, basis: 'stated', anchors }, writer));
  const section = rulesDocSection(state);
  for (const line of lines) {
    assert.ok(section.includes(`[行:${line.id}]`), `第 ${line.position} 行没装`);
  }
  assert.ok(section.indexOf('花钱') < section.indexOf(`[行:${lines[0]?.id ?? ''}]`), '硬线在规矩前面');
  assert.doesNotMatch(memoryDocsSection(state), /### 规则\n/, '目录那一段不再重复正文');
});

test('Memory search finds active lines across docs by bigram overlap, skipping retired', () => {
  const project = state.projects.create({ name: 'Cyber Hunter' });
  ensureMemoryDocs(state);
  const doc = ensureProjectDoc(state, project);
  const kept = addLine(state, { docId: doc.id, section: 'decision', text: '先做 15 天 All-in 推广', basis: 'stated',
    anchors }, writer);
  const gone = addLine(state, { docId: YOU_DOC_ID, text: '15 天以后再决定推广', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.retire(gone.id, gone.version, 'forgotten');
  const hits = searchMemory(state, '推广');
  assert.deepEqual(hits.map((hit) => hit.line.id), [kept.id]);
  assert.equal(hits[0]?.docTitle, 'Cyber Hunter');
});

test('Memory search defaults active-only; archive includes superseded; deleted hidden', () => {
  ensureMemoryDocs(state);
  const old = addLine(state, { docId: YOU_DOC_ID, text: '通知重要的事再发邮件兜底', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.retire(old.id, old.version, 'revised');
  const now = addLine(state, { docId: YOU_DOC_ID, text: '通知只发消息，不发邮件', basis: 'stated', anchors }, writer);
  const gone = addLine(state, { docId: YOU_DOC_ID, text: '邮件通知都关掉', basis: 'stated', anchors }, writer);
  state.memoryDocs.lines.forget([gone.id]);
  assert.deepEqual(searchMemory(state, '邮件').map((hit) => hit.line.id), [now.id]);
  assert.deepEqual(searchMemory(state, '邮件', 20, true).map((hit) => hit.line.id).sort(), [now.id, old.id].sort());
});

test('Doc lookup matches exact name, stripped case-insensitive name, and ID', () => {
  ensureMemoryDocs(state);
  const doc = state.memoryDocs.docs.create({ kind: 'skill', title: '视频解析', summary: '先用自带字幕；要解析视频时读',
    createdBy: 'brain' });
  assert.equal(findDoc(state, '视频解析')?.id, doc.id);
  assert.equal(findDoc(state, ' 视频 解析 ')?.id, doc.id);
  assert.equal(findDoc(state, doc.id)?.id, doc.id);
  assert.equal(findDoc(state, '关于你')?.id, YOU_DOC_ID);
  assert.equal(findDoc(state, '没有这篇'), undefined);
});

test('Today log loads unarchived entries in order, truncating oldest if over limit', () => {
  assert.equal(todaySection(state), '');
  const entry = (text: string, kind: 'fact' | 'decision' = 'fact') => state.memoryJournal.add({ day: '2026-11-07',
    kind, text, anchors, writtenBy: 'brain' });
  const first = entry('侧栏改成图标栏 + 第二栏', 'decision');
  entry('研究周报偏基础研究');
  const section = todaySection(state);
  assert.match(section, /^## 今天的记录/);
  assert.match(section, /- \[决定\] 侧栏改成图标栏 \+ 第二栏\n- \[事实\] 研究周报偏基础研究$/);
  state.memoryJournal.archive([first.id], 'dream-1');
  assert.doesNotMatch(todaySection(state), /侧栏/);
  const long = '这是一条比较长的今天的记录，'.repeat(10);
  for (let index = 0; index < 60; index += 1) {
    entry(`${index}：${long}`);
  }
  const full = todaySection(state);
  assert.match(full, /更早的 \d+ 条这次没装/);
  assert.match(full, /59：/);
  assert.ok(TODAY_BUDGET_TOKENS < 60 * long.length);
});
