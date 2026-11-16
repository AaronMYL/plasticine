// 推到手机（11-16）：一句话加打开那段对话的链接，同一次调用重跑不推第二次；记录看得到谁推的，撤回记下时间。

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { conversationPath, pushRecord, pushTool } from '../../src/app/push-tool.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { openTestState, type TestState } from '../state/helpers.ts';

let h: TestState;
let announced: { body: string; url: string; tag: string }[];

beforeEach(async () => {
  h = await openTestState();
  h.state.lines.main();
  announced = [];
});

afterEach(async () => {
  await h.cleanup();
});

test('push_notify：推一句、点开到主线；重跑不推第二次；撤回记下时间', async () => {
  const tool = pushTool({ state: h.state, announce: (input) => announced.push(input), changed: () => undefined })
    .create({ lineId: MAIN_LINE_ID, kind: 'main', projectId: null });
  await tool.execute('c1', { title: '示例科技回你了' }, new AbortController().signal);
  await tool.execute('c1', { title: '示例科技回你了' }, new AbortController().signal);
  assert.equal(announced.length, 1);
  assert.equal(announced[0]?.url, '/#/plasticine');
  assert.match(announced[0]?.tag ?? '', /^push:push_/);
  const [row] = h.state.pushes.recent(10);
  assert.ok(row);
  assert.deepEqual({ ...pushRecord(h.state, row), id: '', createdAt: '' }, { id: '', title: '示例科技回你了',
    from: '主线', lineId: MAIN_LINE_ID, url: '/#/plasticine', createdAt: '', withdrawnAt: null });
  assert.notEqual(h.state.pushes.withdraw(row.id).withdrawnAt, null);
});

test('打开那段对话：后台的事到工作详情，旁聊到旁聊', () => {
  const background = h.state.lines.create({ kind: 'background', parentLineId: MAIN_LINE_ID, projectId: null,
    title: '海投', sealedPrompt: null, resumeParent: false, modelPurpose: null, mateId: null, mateGroupId: null });
  assert.equal(conversationPath(background), `/#/work/${background.id}`);
  assert.equal(conversationPath(undefined), '/#/plasticine');
});
