// 第13批（11-14 Aaron：「你随时改，它们每晚自己改，能看能撤」）：每晚主线和每位队友各看一遍自己的 Soul——只看那一天
// 他对它说过话的；小改收下、记成「自己改的」；不改、改得太多（重写）不收；一份出错不耽误下一份。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAIN_SOUL_OPENING } from '../../shared/soul-text.ts';
import { soulNight } from '../../src/brain/soul-night.ts';
import { TextModelError, type TextModels, type TextRequest } from '../../src/kernel/index.ts';
import { Mates } from '../../src/mates/service.ts';
import { startKernel } from '../lines/helpers.ts';

const FROM = '2000-01-01T00:00:00.000Z';
const TO = '2100-01-01T00:00:00.000Z';

function models(answers: ((request: TextRequest) => unknown)[]): { models: TextModels; asked: TextRequest[] } {
  const asked: TextRequest[] = [];
  return { asked, models: {
    async ask(request) {
      asked.push(request);
      const answer = answers[asked.length - 1]?.(request);
      if (answer instanceof Error) throw answer;
      return { text: JSON.stringify(answer), complete: true };
    },
  } };
}

test('他说过话的才看：主线小改收下（自己改的、写一句改了什么），没说过话的队友不看', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    const mates = new Mates(state, () => h.kernel);
    const quiet = mates.create({ name: '设计师', avatar: 'cat', hue: 'rose', role: '做界面', soul: '', purpose: null });
    const main = state.lines.main();
    state.lineMessages.append(main.id, 'user', { role: 'user', content: '说话直接一点，别绕弯子。', timestamp: 1 },
      { origin: { kind: 'user' } });
    state.lineMessages.append(quiet.lineId, 'assistant', { role: 'assistant',
      content: [{ type: 'text', text: '我把稿子放这了。' }], stopReason: 'stop', timestamp: 2 });
    const text = `${MAIN_SOUL_OPENING}\n\n## 说话\n- 有话直说，不绕弯子。`;
    const model = models([() => ({ change: true, text, note: '加了一条说话方式' })]);
    assert.equal(await soulNight(state, model.models, '卷毛', FROM, TO, AbortSignal.timeout(5000)), 1);
    assert.equal(model.asked.length, 1, '设计师那天没听他说话，不看');
    assert.match(String(model.asked[0]?.messages[0]?.content), /说话直接一点/);
    assert.equal(state.souls.get('main')?.text, text);
    const [latest] = state.souls.revisions('main', 1);
    assert.deepEqual([latest?.actor, latest?.note], ['self', '加了一条说话方式']);
  } finally { await h.close(); }
});

test('不改、改得太多（重写）不收；一份出错只记下，接着看下一份', async () => {
  const h = await startKernel();
  try {
    const state = h.handle.state;
    const mates = new Mates(state, () => h.kernel);
    const mate = mates.create({ name: '求职顾问', avatar: 'cat', hue: 'teal', role: '简历', soul: '', purpose: null });
    for (const lineId of [state.lines.main().id, mate.lineId]) {
      state.lineMessages.append(lineId, 'user', { role: 'user', content: '今天就这样。', timestamp: 1 },
        { origin: { kind: 'user' } });
    }
    const rewrite = Array.from({ length: 12 }, (_, index) => `## 第 ${String(index)} 节\n- 全新的第 ${String(index)} 条`)
      .join('\n\n');
    const loud = models([() => ({ change: true, text: rewrite, note: '全改了' }), () => ({ change: false })]);
    assert.equal(await soulNight(state, loud.models, '卷毛', FROM, TO, AbortSignal.timeout(5000)), 0);
    assert.equal(state.souls.get('main')?.text, MAIN_SOUL_OPENING);
    const before = state.souls.get(mate.id)?.text ?? '';
    const flaky = models([() => new TextModelError('failed', '断了'),
      () => ({ change: true, text: `${before}\n\n## 性格\n- 直接。`, note: '加了性格' })]);
    assert.equal(await soulNight(state, flaky.models, '卷毛', FROM, TO, AbortSignal.timeout(5000)), 1);
    assert.match(state.souls.get(mate.id)?.text ?? '', /## 性格\n- 直接。/);
  } finally { await h.close(); }
});
