import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { RULES_DOC_ID, YOU_DOC_ID } from '../../shared/state.ts';
import { MAX_ATTEMPTS, MemoryCurator, RETRY_BACKOFF_MS } from '../../src/brain/memory-curator.ts';
import { addLine, ensureMemoryDocs, ensureYouDoc } from '../../src/brain/memory-doc-writes.ts';
import type { StateService } from '../../src/state/index.ts';
import { memoryState, scriptedText, type TextStep } from './helpers.ts';

let state: StateService;
let offsetMs: number;
let changed: string[][];

beforeEach(() => {
  state = memoryState();
  offsetMs = 0;
  changed = [];
});

afterEach(() => {
  state.close();
});

function curator(steps: TextStep[]) {
  const model = scriptedText(steps);
  const instance = new MemoryCurator({ state, now: () => new Date(Date.now() + offsetMs),
    model: { models: model.models }, changed: (docIds) => changed.push([...docIds]) });
  return { instance, requests: model.requests };
}

function json(value: unknown): TextStep {
  return JSON.stringify(value);
}

/** 主线上的一轮：用户说的（可以连说几句）、Plasticine 的回答；用户的话按 line:line-main:<seq> 认。 */
function turn(texts: string[], reply = '好的，记下了。'): { user: { id: string }[]; reply: string } {
  const lineId = state.lines.main().id;
  const user = texts.map((content) => {
    const row = state.lineMessages.append(lineId, 'user', { role: 'user', content, timestamp: 0 },
      { origin: { kind: 'user', userText: content } });
    return { id: `line:${lineId}:${row.seq}` };
  });
  const answer = state.lineMessages.append(lineId, 'assistant', { role: 'assistant',
    content: [{ type: 'text', text: reply }], stopReason: 'stop', timestamp: 0 });
  return { user, reply: `line:${lineId}:${answer.seq}` };
}

test('主线一轮结束后入队一次：同一轮重放回到原来那条，带这一轮全部的用户消息；没有模型就不入队', async () => {
  const { user, reply } = turn(['我住在杭州', '对了，在学吉他']);
  const off = new MemoryCurator({ state, model: null, now: () => new Date() });
  assert.equal(off.enqueueLineTurn('line-main'), null);
  const { instance, requests } = curator([json({ notes: [], used: [] })]);
  const job = instance.enqueueLineTurn('line-main');
  assert.equal(job?.replyId, reply);
  assert.deepEqual(job?.sourceIds, user.map((message) => message.id));
  assert.equal(instance.enqueueLineTurn('line-main')?.id, job?.id);
  await instance.settled();
  assert.equal(state.memoryCuration.jobs.require(job?.id ?? '').status, 'done');
  assert.equal(requests[0]?.purpose, 'memory_curate');
});

test('白天只记：这一轮的事实、决定、纠正、做成的事各追加一条带出处的短记录；主题文档不动，推断和退休留给夜里', async () => {
  ensureYouDoc(state);
  const old = turn(['我养了一只猫']);
  const known = addLine(state, { docId: YOU_DOC_ID, text: '养了一只猫', basis: 'stated',
    anchors: [{ kind: 'message', ref: old.user[0]?.id ?? '' }] }, { actor: 'brain', ref: 'earlier' });
  const { user, reply } = turn(['我搬到重庆了，侧栏改成图标栏吧', '不对，是第二栏只放网页'], '改好了，已经上线。');
  const [first, second] = user.map((message) => message.id);
  const { instance, requests } = curator([json({
    notes: [
      { kind: 'fact', text: '搬到了重庆', doc: YOU_DOC_ID, sources: [first] },
      { kind: 'decision', text: '侧栏改成图标栏 + 第二栏', sources: [first] },
      { kind: 'correction', text: '第二栏只放网页', sources: [second] },
      { kind: 'done', text: '侧栏改版上线了', sources: [reply] },
      { kind: 'fact', text: 'Plasticine 建议他早睡', sources: [reply] },
      { kind: 'remembered', text: '模型不能自己写这种', sources: [first] },
    ],
    remember: [
      { op: 'infer', doc: YOU_DOC_ID, text: '喜欢简洁的界面', why: '改侧栏', sources: [first] },
      { op: 'retire', line: known.id, forget: true, sources: [first] },
    ],
    used: [known.id],
  })]);
  const job = instance.enqueueLineTurn('line-main');
  await instance.settled();
  const entries = state.memoryJournal.open();
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.text]), [
    ['fact', '搬到了重庆'], ['decision', '侧栏改成图标栏 + 第二栏'], ['correction', '第二栏只放网页'],
    ['done', '侧栏改版上线了']]);
  assert.deepEqual(entries[0]?.anchors, [{ kind: 'message', ref: first }]);
  assert.equal(entries[0]?.docId, YOU_DOC_ID);
  assert.match(entries[0]?.day ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(entries[3]?.anchors, [{ kind: 'message', ref: reply }]);
  assert.deepEqual(state.memoryDocs.lines.live(YOU_DOC_ID).map((line) => line.text), ['养了一只猫'], '主题文档不动');
  assert.deepEqual(state.memoryCuration.inferences.list('pending'), []);
  const done = state.memoryCuration.jobs.require(job?.id ?? '');
  assert.equal(done.result?.applied, 4);
  assert.deepEqual(done.result?.rejected.map((item) => item.op).sort(),
    ['infer:memdoc-you', 'note:fact', 'note:remembered', `retire:${known.id}`].sort());
  assert.equal(state.memoryDocs.events.usedLines('2000-01-01T00:00:00.000Z'), 1);
  assert.match(requests[0]?.system ?? '', /白天只记/);
  const material = JSON.parse(requests[0]?.messages[0]?.content as string) as { turn: { replyId: string } };
  assert.equal(material.turn.replyId, reply);
});

test('他明说记住的当场写进主题文档（下一轮就在上下文里），今天的记录里也记一条指向那一行', async () => {
  const { user } = turn(['记住：以后发布别做预检，直接发', '我说橡皮泥就是指 Plasticine'], '好。');
  const [said, term] = user.map((message) => message.id);
  const { instance, requests } = curator([json({
    notes: [],
    remember: [
      { op: 'add', doc: RULES_DOC_ID, text: '发布不做预检，直接发', sources: [said] },
      { op: 'add', doc: RULES_DOC_ID, text: '「橡皮泥」指的是 Plasticine', sources: [term] },
    ],
    used: [],
  })]);
  instance.enqueueLineTurn('line-main');
  await instance.settled();
  const lines = state.memoryDocs.lines.live(RULES_DOC_ID).filter((line) => line.basis !== 'system');
  assert.deepEqual(lines.map((line) => [line.text, line.anchors[0]?.ref]),
    [['发布不做预检，直接发', said], ['「橡皮泥」指的是 Plasticine', term]]);
  const remembered = state.memoryJournal.open();
  assert.deepEqual(remembered.map((entry) => [entry.kind, entry.lineId, entry.docId]),
    lines.map((line) => ['remembered', line.id, RULES_DOC_ID]));
  // 第13批三层：他说的偏好和说法进「关于你」，不再往「规则」里写。
  assert.match(requests[0]?.system ?? '', /说法[\s\S]*专有名词[\s\S]*memdoc-you[\s\S]*「X」指的是/);
  assert.match(requests[0]?.system ?? '', /\[\[那篇的名字\]\]/);
  assert.equal(state.agreements.list({ kind: 'term' }, { limit: 10, offset: 0 }).length, 0);
});

test('他改口说的规矩改那一行：旧说法进归档、新行留「之前」；今天已经记过的同一件事不再记', async () => {
  ensureMemoryDocs(state);
  const old = turn(['每次发布前先跑一遍预检']);
  const before = addLine(state, { docId: RULES_DOC_ID, text: '发布前先跑预检', basis: 'stated',
    anchors: [{ kind: 'message', ref: old.user[0]?.id ?? '' }] }, { actor: 'brain', ref: 'earlier' });
  state.memoryJournal.add({ day: '2026-11-07', kind: 'decision', text: '发布不做预检', anchors: [{ kind: 'message',
    ref: old.user[0]?.id ?? '' }], writtenBy: 'brain' });
  const { user } = turn(['记住，预检不要了，以后直接发']);
  const { instance } = curator([json({ notes: [{ kind: 'decision', text: '发布不做预检。', sources: [user[0]?.id] }],
    remember: [{ op: 'revise', line: before.id, text: '发布不做预检，直接发', sources: [user[0]?.id] }],
    used: [] })]);
  instance.enqueueLineTurn('line-main');
  await instance.settled();
  const [line] = state.memoryDocs.lines.live(RULES_DOC_ID).filter((line) => line.basis !== 'system');
  assert.equal(line?.text, '发布不做预检，直接发');
  assert.equal(line?.previous, '发布前先跑预检');
  assert.deepEqual(state.memoryDocs.lines.archived(RULES_DOC_ID).map((row) => row.id), [before.id]);
  assert.deepEqual(state.memoryJournal.open().map((entry) => entry.kind), ['decision', 'remembered']);
});

test('模型答的不是 JSON：作业停在 failed 带原因、一行不落；退避时间到了重试，3 次后不再自己重试', async () => {
  turn(['我住在杭州']);
  const { instance } = curator(['好的我记住了']);
  const job = instance.enqueueLineTurn('line-main');
  await instance.settled();
  const failed = state.memoryCuration.jobs.require(job?.id ?? '');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error ?? '', /不是能读的 JSON/);
  assert.equal(state.memoryDocs.lines.live(YOU_DOC_ID).length, 0);
  instance.scan();
  await instance.settled();
  assert.equal(state.memoryCuration.jobs.require(failed.id).attempts, 1, '退避时间没到不重试');
  for (let attempt = 1; attempt < MAX_ATTEMPTS + 2; attempt += 1) {
    offsetMs += RETRY_BACKOFF_MS * (attempt + 1);
    instance.scan();
    await instance.settled();
  }
  const exhausted = state.memoryCuration.jobs.require(failed.id);
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.attempts, MAX_ATTEMPTS);
});

test('重启接续：上一个进程里还在做的改回排队；关服务打断的不算一次失败', async () => {
  const { reply } = turn(['我住在杭州']);
  const queued = state.memoryCuration.jobs.enqueue({ key: 'turn:x', kind: 'turn', runId: null,
    replyId: reply, chatId: 'line-main', sourceIds: [] }).job;
  state.memoryCuration.jobs.update(queued.id, queued.version, { status: 'running', attempts: 1 });
  const { instance } = curator([json({ notes: [], used: [] })]);
  assert.equal(instance.recover(), 1);
  const recovered = state.memoryCuration.jobs.require(queued.id);
  assert.equal(recovered.status, 'queued');
  assert.match(recovered.error ?? '', /重新排队/);
  instance.stop();
  instance.kick();
  await instance.settled();
  assert.equal(state.memoryCuration.jobs.require(queued.id).status, 'queued');
});

test('一次性迁移：原话成行并链回旧条目和消息，解释进拿不准的，删过的不迁；原表不动，做完后不再装旧条目', async () => {
  const change = { actor: 'brain' as const, actorRef: 'run-1', reason: '测试' };
  const said = 'source-user-said';
  const quote = state.memory.create({ text: '我住在杭州', kind: 'quote', basis: 'self_reported', sourceId: said,
    provenance: '对话', anchor: { kind: 'message', ref: 'msg-old' } }, change);
  const guess = state.memory.create({ text: '他可能喜欢安静', kind: 'interpretation', basis: 'inferred',
    sourceId: said, provenance: '推测' }, change);
  const removed = state.memory.create({ text: '删掉的', kind: 'quote', basis: 'self_reported', sourceId: said,
    provenance: '对话' }, change);
  state.memory.update(removed.id, removed.version, { deletedAt: new Date().toISOString() }, change);
  const before = state.memory.listAll({}, { limit: 50 }).map((entry) => [entry.id, entry.version]);
  const { instance, requests } = curator([json({ ops: [
    { op: 'add', doc: YOU_DOC_ID, text: '住在杭州', sources: [quote.id] },
    { op: 'add', doc: YOU_DOC_ID, text: '喜欢安静', sources: [guess.id] },
    { op: 'infer', doc: YOU_DOC_ID, text: '喜欢安静', why: '旧版的推测', sources: [guess.id] },
  ] })]);
  instance.scan();
  await instance.settled();
  const migration = state.memoryCuration.migration;
  assert.equal(migration.find(quote.id)?.outcome, 'line');
  assert.equal(migration.find(guess.id)?.outcome, 'inference');
  assert.equal(migration.find(removed.id)?.note, '用户删过');
  const [line] = state.memoryDocs.lines.live(YOU_DOC_ID);
  assert.deepEqual(line?.anchors, [{ kind: 'memory_entry', ref: quote.id }, { kind: 'message', ref: 'msg-old' }]);
  assert.equal(line?.migratedDefault, true);
  assert.equal(line?.writtenBy, 'migration');
  assert.equal(migration.finished(), true);
  assert.deepEqual(state.memory.listAll({}, { limit: 50 }).map((entry) => [entry.id, entry.version]), before);
  const material = JSON.parse(requests[0]?.messages[0]?.content as string) as { entries: { id: string }[] };
  // 两条同一时刻建的，批内顺序只按 id 定，所以比集合不比顺序。
  assert.deepEqual(material.entries.map((entry) => entry.id).sort(), [quote.id, guess.id].sort());
  instance.scan();
  await instance.settled();
  assert.equal(requests.length, 1, '做完的迁移重跑是空操作');
});

test('迁移分批、可中断续跑：一批失败只停在那一批，重试时同一批接着做，已迁的不重做', async () => {
  const change = { actor: 'brain' as const, actorRef: 'run-1', reason: '测试' };
  const said = 'source-user-said';
  const entries = Array.from({ length: 25 }, (_, index) => state.memory.create({ text: `第 ${index} 件事`,
    kind: 'quote', basis: 'self_reported', sourceId: said, provenance: '对话' }, change));
  const { instance, requests } = curator(['不是 JSON', json({ ops: [] })]);
  instance.scan();
  await instance.settled();
  const [failed] = state.memoryCuration.jobs.withStatus('failed');
  assert.equal(failed?.sourceIds.length, 20);
  assert.equal(state.memoryCuration.migration.progress(state.memoryCuration.migration.state()?.cutoff ?? '')
    .pending, 25);
  offsetMs += RETRY_BACKOFF_MS * 2;
  instance.scan();
  await instance.settled();
  assert.equal(state.memoryCuration.jobs.require(failed?.id ?? '').status, 'done');
  assert.equal(state.memoryCuration.migration.find(entries[24]?.id ?? '')?.outcome, 'skipped');
  assert.equal(state.memoryCuration.migration.finished(), true);
  assert.equal(requests.length, 3, '失败一次、重试那一批、再做剩下的 5 条');
});

test('白天不合并：超了上限只标出来；夜里排的合并压缩把几行合成一行、锚点取并集，没变短的拒绝', async () => {
  const doc = state.memoryDocs.docs.create({ kind: 'topic', title: '读书', summary: '用户读的书', charLimit: 200,
    createdBy: 'system' });
  ensureYouDoc(state);
  const writer = { actor: 'brain' as const, ref: 'earlier' };
  const rows = ['在读《置身事内》，讲地方政府和土地财政，读到第三章', '《置身事内》第三章讲土地财政，读得很慢',
    '想读完《置身事内》后写一篇笔记，讲自己的理解和疑问', '另外在读一本关于宇宙学的科普书，书名还没想起来，'
    + '读得断断续续，大概一周读一两章，读完以后想和小雨讨论一下里面关于暗物质的部分',
    '读书习惯：晚上睡前读半小时，周末会去楼下的咖啡馆读一下午，喜欢纸质书，不太用电子阅读器，读到好句子会拍照'];
  const lines = rows.map((text, index) => addLine(state, { docId: doc.id, text, basis: 'stated',
    anchors: [{ kind: 'message', ref: `m${index}` }] }, writer));
  const { user } = turn(['我在读一本宇宙学的书']);
  const { instance, requests } = curator([
    json({ notes: [], remember: [{ op: 'restated', line: lines[3]?.id, sources: [user[0]?.id] }], used: [] }),
    json({ merges: [
      { lines: [lines[0]?.id, lines[1]?.id], text: '在读《置身事内》（土地财政），读到第三章，读得慢' },
      { lines: [lines[2]?.id], text: '想读完《置身事内》后写一篇笔记，讲自己的理解和疑问，再多写几句' },
    ] }),
  ]);
  const before = state.memoryDocs.lines.size(doc.id).chars;
  assert.ok(before >= 170, `在用 ${before} 字，测试要让它超过 85%`);
  instance.enqueueLineTurn('line-main');
  await instance.settled();
  assert.deepEqual(requests.map((request) => request.purpose), ['memory_curate'], '白天不排合并压缩');
  assert.equal(state.memoryCuration.jobs.openCompaction(doc.id), undefined);
  state.memoryCuration.jobs.enqueue({ key: `compact:${doc.id}:1`, kind: 'compact', docId: doc.id, sourceIds: [] });
  instance.kick();
  await instance.settled();
  assert.deepEqual(requests.map((request) => request.purpose), ['memory_curate', 'memory_compact']);
  const compact = state.memoryCuration.jobs.withStatus('done').find((job) => job.kind === 'compact');
  assert.equal(compact?.result?.applied, 1);
  assert.match(compact?.result?.rejected[0]?.reason ?? '', /没有比原来短/);
  const live = state.memoryDocs.lines.live(doc.id);
  const merged = live.find((line) => line.supersedes.length === 2);
  assert.deepEqual(merged?.anchors, [{ kind: 'message', ref: 'm0' }, { kind: 'message', ref: 'm1' }]);
  assert.equal(merged?.position, lines[0]?.position);
  assert.ok(state.memoryDocs.lines.size(doc.id).chars < before);
});
