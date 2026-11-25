import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { startKernel } from './helpers.ts';

test('Two continuations after truncation keep full text from part 1 to conclusion', async () => {
  const h = await startKernel();
  try {
    h.respond([fauxAssistantMessage('第一部分。\n\n', { stopReason: 'length' })]);
    const line = h.kernel.open({ title: '完整分析', goal: '写一份完整分析。', projectId: null,
      parentLineId: h.kernel.view('main').id });
    await h.kernel.settled();
    h.respond([fauxAssistantMessage('第二部分。\n\n', { stopReason: 'length' })]);
    h.kernel.retry(line.id);
    await h.kernel.settled();
    assert.equal(h.kernel.answer(line.id), null);
    assert.equal(h.kernel.view(line.id).lastAnswer, '第一部分。\n\n第二部分。');
    h.respond([fauxAssistantMessage('最终结论。')]);
    h.kernel.retry(line.id);
    await h.kernel.settled();
    assert.equal(h.kernel.answer(line.id), '第一部分。\n\n第二部分。\n\n最终结论。');
    assert.equal(h.kernel.view(line.id).lastAnswer, h.kernel.answer(line.id));
    assert.equal(h.kernel.read('main', 10).messages.at(-1)?.text, '第一部分。', '贴回父线的只有一段');
    await h.kernel.stop();
    const restarted = await startKernel({ handle: h.handle });
    try {
      assert.equal(restarted.kernel.answer(line.id), '第一部分。\n\n第二部分。\n\n最终结论。');
      assert.equal(restarted.kernel.view(line.id).lastAnswer, restarted.kernel.answer(line.id));
    } finally {
      await restarted.kernel.stop();
    }
  } finally {
    await h.close();
  }
});

test('Rework after completed continuation returns new draft without appending old parts', async () => {
  const h = await startKernel();
  try {
    h.respond([fauxAssistantMessage('原稿第一段。', { stopReason: 'length' })]);
    const line = h.kernel.open({ title: '改稿', goal: '写第一稿。', projectId: null, parentLineId: null });
    await h.kernel.settled();
    h.respond([fauxAssistantMessage('原稿第二段。')]);
    h.kernel.retry(line.id);
    await h.kernel.settled();
    assert.equal(h.kernel.answer(line.id), '原稿第一段。原稿第二段。');
    h.respond([fauxAssistantMessage('按新要求完整重写的第二稿。')]);
    h.kernel.send(line.id, { text: '换个角度，完整重写。' });
    await h.kernel.settled();
    assert.equal(h.kernel.answer(line.id), '按新要求完整重写的第二稿。');
    assert.equal(h.kernel.view(line.id).lastAnswer, '按新要求完整重写的第二稿。');
  } finally {
    await h.close();
  }
});

test('Queued rewrite instruction after truncation excludes old half-draft from result', async () => {
  const h = await startKernel();
  try {
    h.respond([fauxAssistantMessage('不采用的原稿。', { stopReason: 'length' })]);
    const line = h.kernel.open({ title: '另写一稿', goal: '写一份分析。', projectId: null, parentLineId: null });
    await h.kernel.settled();
    h.kernel.send(line.id, { text: '不要沿用上段，改成一页结论。' });
    h.respond([fauxAssistantMessage('重写后的一页结论。')]);
    h.kernel.retry(line.id);
    await h.kernel.settled();
    assert.equal(h.kernel.answer(line.id), '重写后的一页结论。');
    assert.equal(h.kernel.view(line.id).lastAnswer, '重写后的一页结论。');
  } finally {
    await h.close();
  }
});
