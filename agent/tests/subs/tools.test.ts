// 给模型的空间与订阅工具（第 6、7 条）：从一句话到草案、样刊、按反馈调、开定时。
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { KernelTool } from '../../src/lines/index.ts';
import { subsTools, type RunPort } from '../../src/subs/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let t: TestState;
let opened: string[];
beforeEach(async () => { t = await openTestState(); opened = []; });
afterEach(async () => { await t.cleanup(); });

const PORT: RunPort = {
  open(input) {
    opened.push(input.goal);
    return 'line-sub';
  },
  tell: () => true,
};

async function call(tools: KernelTool[], name: string, args: unknown): Promise<Record<string, unknown>> {
  const found = tools.find((item) => item.name === name);
  assert.ok(found, name);
  const result = await found.create({ lineId: 'line-main', kind: 'main', projectId: null }).execute('call-1',
    args as never);
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse(first.type === 'text' ? first.text : '{}') as Record<string, unknown>;
}

test('「我想要一个认知与神经科学的研究周报」：草案带默认结构、列出要追问的缺口；样刊、按反馈调、开定时', async () => {
  const tools = subsTools(t.state, () => PORT, () => new Date('2026-11-07T08:00:00Z'));
  const draft = await call(tools, 'subscription_draft', { title: '认知与神经科学研究周报', topics: ['睡眠'] });
  assert.deepEqual(draft['gaps'], ['基础还是临床', '专业还是科普']);
  const id = String(draft['id']);
  assert.equal(t.state.subscriptions.require(id).timeZone, 'Asia/Shanghai');
  await call(tools, 'subscription_run', { id });
  assert.match(opened[0] ?? '', /第 1 期/);
  const issue = await call(tools, 'space_write', { title: '研究周报 · 第 1 期', subscriptionId: id,
    doc: { headline: '睡眠中的记忆重放', stats: [{ value: '14', label: '篇读过' }], blocks: [], sources: [] } });
  assert.equal(issue['issueNumber'], 1);
  assert.equal(issue['link'], `#/books/space/${String(issue['id'])}`);
  const sampled = t.state.subscriptions.require(id);
  assert.equal(sampled.status, 'sample');
  const tuned = await call(tools, 'subscription_update', { id, version: sampled.version,
    settings: { focus: 'basic', depth: 'expert' } });
  const active = await call(tools, 'subscription_update', { id, version: Number(tuned['version']), status: 'active' });
  assert.equal(active['status'], 'active');
  const settings = t.state.subscriptions.require(id).settings;
  assert.equal(settings.kind === 'research' ? settings.focus : null, 'basic');
});

test('space_write 不合规（图表数据个数对不上）就报一句能照着改的话', async () => {
  const tools = subsTools(t.state, () => PORT, () => new Date());
  await assert.rejects(call(tools, 'space_write', { title: '核查', doc: { stats: [], sources: [], blocks: [{
    type: 'chart', kind: 'bar', title: '销量', x: ['一月', '二月'], series: [{ name: '销量', values: [1] }],
    caption: '月销量', source: { label: '行业协会月报' } }] } }), /横轴/);
});

test('他删了的空间：space_list 不列，space_read 明说已删除，space_write 改它要先还原', async () => {
  const tools = subsTools(t.state, () => PORT, () => new Date());
  const written = await call(tools, 'space_write', { title: '签证核查',
    doc: { headline: '能办', stats: [], blocks: [], sources: [] } });
  const id = String(written['id']);
  t.state.spaces.markDeleted(id, Number(written['version']));
  const listed = await call(tools, 'space_list', {});
  assert.deepEqual(listed['spaces'], []);
  await assert.rejects(call(tools, 'space_read', { id }), /已删除/);
  await assert.rejects(call(tools, 'space_write', { id, version: 2, title: '签证核查',
    doc: { headline: '改', stats: [], blocks: [], sources: [] } }), /最近删除/);
});
