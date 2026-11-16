import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { KernelTool, LineScope } from '../../src/lines/index.ts';
import { MAIN_LINE_ID, type LineWatch } from '../../src/state/index.ts';
import { addedLines, LineTimers, watchText } from '../../src/timers/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

const SCOPE: LineScope = { lineId: MAIN_LINE_ID, kind: 'main', projectId: null };

let h: TestState;
let now: number;
let woken: { lineId: string; text: string; ref: string }[];
let pages: string[];
let reads: LineWatch[];
let timers: LineTimers;

beforeEach(async () => {
  h = await openTestState();
  h.state.lines.main();
  now = Date.parse('2026-11-16T08:00:00.000Z');
  woken = [];
  pages = [];
  reads = [];
  timers = new LineTimers({ state: h.state, now: () => new Date(now), later: () => () => undefined,
    wake: (lineId, text, ref) => woken.push({ lineId, text, ref }),
    read: async (watch) => {
      reads.push(watch);
      const page = pages.shift();
      if (page === undefined) throw new Error('网页打不开');
      return page;
    },
    changed: () => undefined });
});

afterEach(async () => {
  await h.cleanup();
});

function tool(name: string): KernelTool {
  const found = timers.tools().find((candidate) => candidate.name === name);
  assert.ok(found, name);
  return found;
}

async function run(name: string, args: Record<string, unknown>, callId: string): Promise<Record<string, unknown>> {
  const result = await tool(name).create(SCOPE).execute(callId, args, new AbortController().signal);
  const text = result.content[0];
  assert.ok(text?.type === 'text');
  return JSON.parse(text.text) as Record<string, unknown>;
}

test('回来看：到点往线里说一句，只叫一次；同一次调用重跑认回同一条；他关掉的不叫', async () => {
  const first = await run('line_wake_later', { minutes: 30, note: '看示例公司 HR 回了没' }, 'w1');
  const again = await run('line_wake_later', { minutes: 30, note: '看示例公司 HR 回了没' }, 'w1');
  assert.equal(again['id'], first['id']);
  await run('line_wake_later', { minutes: 10, note: '先看看邮箱' }, 'w2');
  assert.deepEqual(timers.views().map((view) => view.title), ['先看看邮箱', '看示例公司 HR 回了没']);
  timers.cancel(String(timers.views()[0]?.id));
  now += 31 * 60_000;
  await timers.tick();
  await timers.tick();
  assert.equal(woken.length, 1);
  assert.match(woken[0]?.text ?? '', /看示例公司 HR 回了没/);
  assert.equal(woken[0]?.ref, `wake:${String(first['id'])}`);
  assert.deepEqual(timers.views(), []);
  await assert.rejects(run('line_wake_later', { minutes: 5, at: '2026-11-17T08:00:00Z', note: '两样都给' }, 'w3'),
    /给一样/);
});

test('盯着：第一次记下样子，变了叫醒并给出新出现的那些；看不了的记原因接着盯', async () => {
  await run('watch_start', { title: '示例官网公告', url: 'https://example.com/news', everyMinutes: 10 }, 's1');
  pages.push('公告\n11 月 1 日 系统维护');
  await timers.tick();
  assert.equal(woken.length, 0, '第一次只记下');
  now += 11 * 60_000;
  pages.push('公告\n11 月 16 日 新版本发布\n11 月 1 日 系统维护');
  await timers.tick();
  assert.equal(woken.length, 1);
  assert.match(woken[0]?.text ?? '', /新版本发布/);
  assert.doesNotMatch(woken[0]?.text ?? '', /系统维护/);
  now += 11 * 60_000;
  await timers.tick();
  const view = timers.views()[0];
  assert.equal(view?.checks, 3);
  assert.equal(view?.lastError, '网页打不开');
  assert.equal(woken.length, 1);
});

test('盯着等一段字：出现了叫醒并停下；到期没等到也说一声', async () => {
  await run('watch_start', { title: '示例快递', url: 'https://example.com/track', lookFor: '已签收', hours: 1 }, 's2');
  pages.push('运输中');
  await timers.tick();
  now += 31 * 60_000;
  pages.push('运输中\n已签收');
  await timers.tick();
  assert.equal(woken.length, 1);
  assert.match(woken[0]?.text ?? '', /出现了「已签收」/);
  assert.deepEqual(timers.views(), []);
  await run('watch_start', { title: '示例审核', url: 'https://example.com/review', lookFor: '通过', hours: 1 }, 's3');
  pages.push('审核中');
  await timers.tick();
  now += 2 * 60 * 60_000;
  pages.push('审核中');
  await timers.tick();
  assert.match(woken[1]?.text ?? '', /到期了/);
  await assert.rejects(run('watch_start', { title: '两样都没给', everyMinutes: 10 }, 's4'), /给一样/);
});

test('比对用的字和新出现的行', () => {
  assert.equal(watchText('  a   b \n\n c '), 'a b\nc');
  assert.equal(addedLines('a\nb', 'a\nc\nb'), 'c');
});

test('盯 Mac 上的文件夹（11-16）：nodeId + folder 记下来，读的时候带着；三样给多了、nodeId 落了都不收', async () => {
  await run('watch_start', { title: '下载完了没有', nodeId: 'mac-1', folder: '~/Downloads' }, 'f1');
  pages.push('a.zip · 10 字节 · 2026-11-16T08:00:00.000Z');
  await timers.tick();
  assert.deepEqual(reads[0]?.folder, { nodeId: 'mac-1', path: '~/Downloads' });
  assert.equal(reads[0]?.tab, null);
  await assert.rejects(run('watch_start', { title: '两样', url: 'https://example.com', nodeId: 'mac-1',
    folder: '~/Downloads' }, 'f2'), /给一样/);
  await assert.rejects(run('watch_start', { title: '缺设备', folder: '~/Downloads' }, 'f3'), /给一样/);
});
