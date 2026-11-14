// 新消息通知从哪来（第13批）：只通知他自己发起的那一轮的回复——主线、队友、群组；主线派给队友的、后台线的不通知。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import type { MateDraft } from '../../shared/api/index.ts';
import { lineReplyAlert } from '../../src/app/reply-alerts.ts';
import { setMainIdentity } from '../../src/mates/main-identity.ts';
import { Mates } from '../../src/mates/service.ts';
import { startKernel } from '../lines/helpers.ts';

const draft: MateDraft = { name: '求职顾问', role: '帮他找工作', avatar: 'cat', hue: 'sky', soul: '先核对原文。',
  purpose: null };

test('他发起的那一轮：主线写主线的名字，队友写队友的名字；派活、后台线、还没回的不通知', async () => {
  const h = await startKernel({ noModel: true });
  try {
    const { state } = h.handle;
    setMainIdentity(state, { name: '卷毛' });
    const main = state.lines.main();
    const say = (lineId: string, kind: 'user' | 'delegation', text: string): void => {
      state.lineMessages.append(lineId, 'user', { role: 'user', content: text, timestamp: 1 },
        { origin: { kind, userText: text } });
    };
    say(main.id, 'user', '帮我查三家公司');
    assert.equal(lineReplyAlert(state, main), null, '还没回');
    const reply = state.lineMessages.append(main.id, 'assistant', fauxAssistantMessage('查好了，**三家**都能投。'));
    assert.deepEqual(lineReplyAlert(state, main), { lineId: main.id, seq: reply.seq, name: '卷毛',
      text: '查好了，**三家**都能投。' });

    const mate = new Mates(state, () => h.kernel).create(draft);
    const mateLine = state.lines.require(mate.lineId);
    say(mateLine.id, 'delegation', '主线派来的活');
    state.lineMessages.append(mateLine.id, 'assistant', fauxAssistantMessage('做完了'));
    assert.equal(lineReplyAlert(state, mateLine), null, '主线和队友之间的不通知');
    say(mateLine.id, 'user', '简历改好了吗');
    state.lineMessages.append(mateLine.id, 'assistant', fauxAssistantMessage('第二版改好了'));
    assert.equal(lineReplyAlert(state, mateLine)?.name, '求职顾问');

    const background = state.lines.create({ kind: 'background', parentLineId: main.id, projectId: null,
      title: '后台的事' });
    say(background.id, 'user', '后台');
    state.lineMessages.append(background.id, 'assistant', fauxAssistantMessage('好了'));
    assert.equal(lineReplyAlert(state, state.lines.require(background.id)), null);
  } finally { await h.close(); }
});
