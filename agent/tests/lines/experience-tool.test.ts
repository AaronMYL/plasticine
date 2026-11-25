import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { experienceTool } from '../../src/lines/index.ts';
import { openTestState } from '../state/helpers.ts';
import { startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

test('note_experience records site entry with line source and plain-language step', async () => {
  const handle = await openTestState();
  const tool = experienceTool(handle.state);
  const h = await startKernel({ handle, tools: [tool] });
  open.push(h);
  const { state } = handle;
  assert.equal(tool.say({ text: '链接要带着 xsec_token 才打得开' }), '记一条经验：链接要带着 xsec_token 才打得开');
  assert.equal(tool.hardLine({}), null);
  h.respond([
    fauxAssistantMessage([fauxToolCall('note_experience', { topic: '小红书', kind: 'do',
      text: '链接要带着 xsec_token 才打得开' }, { id: 'exp-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('存好了。'),
  ]);
  h.kernel.send('main', { text: '把这篇小红书笔记存下来' });
  await until(() => state.memoryDocs.docs.live().some((doc) => doc.kind === 'how'), '经验记下了');
  const doc = state.memoryDocs.docs.live().find((item) => item.kind === 'how')!;
  assert.equal(doc.title, '小红书');
  const line = state.memoryDocs.lines.live(doc.id)[0]!;
  assert.deepEqual([line.section, line.basis, line.writtenBy], ['do', 'tried', 'brain']);
  assert.deepEqual(line.anchors, [{ kind: 'work', ref: `line:${state.lines.main().id}` }]);
});
