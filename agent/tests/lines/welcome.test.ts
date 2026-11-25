import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { startKernel, type Harness } from './helpers.ts';

const open: Harness[] = [];

async function harness(): Promise<Harness> {
  const started = await startKernel();
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const WELCOME = {
  text: '你好，测试名。我是 Plasticine。',
  starts: [
    { id: 'notes', label: '导入我的笔记', icon: 'note', prompt: '我想把我的笔记导进来。' },
    { id: 'chat', label: '先聊聊，认识一下', icon: 'chat', prompt: '我们先聊聊吧。' },
  ],
};

test('Main line welcome has welcome role, non-user source, start button, no model call', async () => {
  const h = await harness();
  const view = h.kernel.welcome(WELCOME);
  assert.equal(view?.role, 'welcome');
  await h.kernel.settled();
  const main = h.kernel.read('main', 50);
  assert.equal(main.line.status, 'idle');
  assert.equal(h.faux.state.callCount, 0);
  const message = main.messages.at(-1);
  assert.equal(message?.role, 'welcome');
  assert.equal(message?.origin, null);
  assert.equal(message?.text, WELCOME.text);
  assert.deepEqual(message?.starts, WELCOME.starts);
  assert.ok(h.events.some((event) => event.type === 'line_message' && event.message.role === 'welcome'));
});

test('Subsequent user message shows welcome as sent by Plasticine, not by the user', async () => {
  const h = await harness();
  h.kernel.welcome(WELCOME);
  let seen = '';
  h.respond([(context) => {
    const welcome = context.messages.find((message) => message.role === 'user' && typeof message.content === 'string'
      && message.content.includes('欢迎'));
    seen = welcome?.role === 'user' && typeof welcome.content === 'string' ? welcome.content : '';
    return fauxAssistantMessage('好。');
  }]);
  h.kernel.send('main', { text: '我们先聊聊吧。' });
  await h.kernel.settled();
  assert.match(seen, /Plasticine 发过一条欢迎/);
  assert.match(seen, /这不是用户说的/);
  assert.match(seen, /测试名/);
});
