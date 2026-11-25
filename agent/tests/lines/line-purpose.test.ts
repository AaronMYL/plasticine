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

test('Line opened with purpose uses that model purpose; background defaults to agent', async () => {
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

test('Sealed reply line always uses network_reply regardless of specified purpose', async () => {
  const h = await startKernel();
  open.push(h);
  h.respond([fauxAssistantMessage('好的。')]);
  h.kernel.open({ title: '代答', goal: '他问什么', projectId: null, parentLineId: null, sealedPrompt: '只答这一句。',
    purpose: 'review' });
  await h.kernel.settled();
  assert.deepEqual(h.purposes, ['network_reply']);
});
