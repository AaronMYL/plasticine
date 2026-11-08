// 做梦（《优化清单》第 10 条夜里那一半）：对话导成纯文字交给 dream 模型；他说的话能当事实、别的只能提推断；新加 / 替换
// 记进「昨晚整理了什么」可撤销；冲突两条都留；走不通的路；当天要点；今天的记录进归档；不能删，只能挪进归档；
// 整理期间白天改过的行，那一条操作被拒（代码合并，不靠提示词读回来核对）。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { YOU_DOC_ID } from '../../shared/state.ts';
import { addLine, Dreamer, ensureMemoryDocs, type DreamSkills } from '../../src/brain/index.ts';
import type { TextModels, TextRequest } from '../../src/kernel/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
beforeEach(async () => { t = await openTestState(); });
afterEach(async () => { await t.cleanup(); });

const FROM = '2000-01-01T00:00:00.000Z';
const TO = '2100-01-01T00:00:00.000Z';

function say(lineId: string, text: string): string {
  const row = t.state.lineMessages.append(lineId, 'user', { role: 'user', content: text, timestamp: 1 },
    { origin: { kind: 'user' } });
  return `line:${lineId}:${row.seq}`;
}

function reply(lineId: string, text: string): string {
  const row = t.state.lineMessages.append(lineId, 'assistant', { role: 'assistant',
    content: [{ type: 'text', text }], stopReason: 'stop', timestamp: 2 });
  return `line:${lineId}:${row.seq}`;
}

function dreamer(answer: (request: TextRequest) => unknown, skills: DreamSkills | null = null) {
  const asked: TextRequest[] = [];
  const models: TextModels = {
    async ask(request) {
      asked.push(request);
      return { text: JSON.stringify(answer(request)), complete: true };
    },
  };
  const now = (): Date => new Date('2026-11-08T01:00:00Z');
  return { asked, dreamer: new Dreamer({ state: t.state, models, skills, now }) };
}

const input = { from: FROM, to: TO, today: '2026-11-08', fixSummaries: true, signal: AbortSignal.timeout(5000) };

test('没有新对话也没有今天的记录：跳过，不叫模型', async () => {
  const { asked, dreamer: d } = dreamer(() => ({}));
  const report = await d.dream(input);
  assert.equal(report.skipped, true);
  assert.equal(asked.length, 0);
});

test('一晚整理：对话导成纯文字；新加、替换、拿不准、走不通的路记进这一页；要点写好；今天的记录进归档', async () => {
  const main = t.state.lines.main();
  t.state.lineDays.start(main.id, '2026-11-07', 1);
  ensureMemoryDocs(t.state);
  const old = addLine(t.state, { docId: YOU_DOC_ID, text: '住在北京', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'line:line-main:0' }] }, { actor: 'brain', ref: null });
  const moved = say(main.id, '我搬到杭州了，在高新区');
  const answer = reply(main.id, '好的，记下了。');
  const tried = say(main.id, '用 rsync 同步不行，服务器上没装');
  const journal = t.state.memoryJournal.add({ day: '2026-11-07', kind: 'decision', text: '悬赏平台先做验收规则',
    anchors: [{ kind: 'message', ref: moved }], writtenBy: 'brain' });
  const { asked, dreamer: d } = dreamer(() => ({
    ops: [
      { op: 'revise', line: old.id, text: '住在杭州西湖区', sources: [moved] },
      { op: 'add', doc: YOU_DOC_ID, section: 'note', text: '悬赏平台先做验收规则', sources: [`journal:${journal.id}`] },
      { op: 'add', doc: YOU_DOC_ID, section: 'note', text: '喜欢简短的回复', sources: [answer] },
      { op: 'infer', doc: YOU_DOC_ID, text: '可能喜欢杭帮菜', why: '搬到杭州', sources: [moved] },
      { op: 'retire', line: old.id, forget: true, sources: [moved] },
    ],
    conflicts: [{ doc: YOU_DOC_ID, candidates: [{ text: '周报周一出', sources: [moved] },
      { text: '周报周日出', sources: [tried] }] }],
    deadEnds: [{ text: '用 rsync 同步：服务器上没装', sources: [tried] }],
    digests: [{ line: main.id, day: '2026-11-07', text: '他搬到杭州；悬赏平台先做验收规则。' }],
  }));
  const report = await d.dream(input);
  assert.equal(asked[0]?.purpose, 'dream');
  const material = JSON.parse(asked[0]?.messages[0]?.content ?? '{}') as { transcripts: string; journal: unknown[] };
  assert.match(material.transcripts, new RegExp(`\\[${moved}\\] 他：我搬到杭州了`));
  assert.match(material.transcripts, /Plasticine：好的，记下了。/);
  assert.equal(material.journal.length, 1);
  const changes = t.state.memoryDreams.changes(report.dream?.id ?? '');
  assert.deepEqual(changes.map((change) => change.kind), ['replace', 'add', 'unsure', 'dead_end']);
  assert.equal(changes[0]?.previous, '住在北京');
  assert.equal(t.state.memoryDocs.lines.get(old.id)?.retiredAt !== null, true, '旧说法进了归档');
  assert.equal(report.rejected >= 2, true, 'Plasticine 说的不能当事实；旧行已经改过，不能再 retire');
  assert.equal(t.state.memoryCuration.inferences.list('pending', { limit: 10 })[0]?.text, '可能喜欢杭帮菜');
  assert.equal(changes[2]?.candidates.length, 2);
  assert.equal(t.state.lineDays.get(main.id, '2026-11-07')?.digest, '他搬到杭州；悬赏平台先做验收规则。');
  assert.equal(t.state.memoryJournal.open().length, 0);
  assert.equal(t.state.memoryJournal.archived()[0]?.dreamId, report.dream?.id);
  assert.notEqual(report.dream?.finishedAt, null);
  assert.equal(report.dream?.linesRead, 1);
});

test('整理期间白天改过那一行：这一条被拒，留到下一晚，别的照落', async () => {
  const main = t.state.lines.main();
  ensureMemoryDocs(t.state);
  const line = addLine(t.state, { docId: YOU_DOC_ID, text: '每天 7 点起', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'line:line-main:0' }] }, { actor: 'brain', ref: null });
  const said = say(main.id, '我现在 6 点起，也开始跑步了');
  const { dreamer: d } = dreamer(() => {
    // 模型还在想的时候，他在记忆页把那一行改了。
    const current = t.state.memoryDocs.lines.require(line.id);
    t.state.memoryDocs.lines.retire(current.id, current.version, 'edited');
    return { ops: [{ op: 'revise', line: line.id, text: '每天 6 点起', sources: [said] },
      { op: 'add', doc: YOU_DOC_ID, section: 'note', text: '开始跑步了', sources: [said] }] };
  });
  const report = await d.dream(input);
  assert.equal(report.rejected, 1);
  assert.deepEqual(t.state.memoryDreams.changes(report.dream?.id ?? '').map((change) => change.text), ['开始跑步了']);
});

test('做成的新做法写成技能（只新建，不改已有的）', async () => {
  const main = t.state.lines.main();
  say(main.id, '以后发版都先跑 typecheck');
  const written: string[] = [];
  const skills: DreamSkills = { exists: (name) => name === 'old-skill', write: (name, content) => {
    written.push(`${name}\n${content}`);
  } };
  const { dreamer: d } = dreamer(() => ({ skills: [
    { name: 'release-check', description: '发版前', body: '1. 跑 typecheck' },
    { name: 'old-skill', description: '已有', body: '不改' },
    { name: 'Bad Name', description: 'x', body: 'y' },
  ] }), skills);
  await d.dream(input);
  assert.equal(written.length, 1);
  assert.match(written[0] ?? '', /^release-check\n---\nname: release-check\ndescription: "发版前"/);
});
