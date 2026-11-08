// 开线能指定模型用途（《优化清单》第 13 条接线，第 6 批二段 night 线）：研究周报用 researcher、回顾用 review、
// 心跳开的活用 heartbeat、做梦用 dream；不指定的后台线照旧用 agent。用途记在线上，重启以后接着跑也按它取模型。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { startKernel, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

test('开线带了用途：这条线每次取模型都按这个用途；没带的后台线还是 agent', async () => {
  const h = await startKernel();
  open.push(h);
  h.respond([fauxAssistantMessage('第 1 期写好了。'), fauxAssistantMessage('查完了。')]);
  const weekly = h.kernel.open({ title: '研究周报', goal: '写第 1 期', projectId: null, parentLineId: null,
    purpose: 'researcher' });
  await h.kernel.settled();
  assert.equal(h.handle.state.lines.require(weekly.id).modelPurpose, 'researcher');
  assert.deepEqual(h.purposes, ['researcher']);
  h.kernel.open({ title: '查资料', goal: '查一下', projectId: null, parentLineId: null });
  await h.kernel.settled();
  assert.deepEqual(h.purposes, ['researcher', 'agent']);
});

test('封起来的线（替别人答话）不管带没带用途都用 network_reply', async () => {
  const h = await startKernel();
  open.push(h);
  h.respond([fauxAssistantMessage('好的。')]);
  h.kernel.open({ title: '代答', goal: '他问什么', projectId: null, parentLineId: null, sealedPrompt: '只答这一句。',
    purpose: 'review' });
  await h.kernel.settled();
  assert.deepEqual(h.purposes, ['network_reply']);
});
