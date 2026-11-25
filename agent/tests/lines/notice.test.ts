import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { deferred, slowTool, startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

async function harness(options: Parameters<typeof startKernel>[0] = {}): Promise<Harness> {
  const started = await startKernel(options);
  open.push(started);
  return started;
}

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

const NOTICE = { key: 'project-overdue:p1:2026-10-30', text: '项目「资料交接」过了截止日还没完成。',
  brief: '有项目过了截止' };

test('Idle main line writes system notice without starting turn or spoofing user', async () => {
  const h = await harness();
  const view = h.kernel.notice(NOTICE);
  assert.equal(view?.role, 'notice');
  await h.kernel.settled();
  const main = h.kernel.read('main', 50);
  assert.equal(main.line.status, 'idle', '不开一轮');
  assert.equal(h.faux.state.callCount, 0, '没有请求模型');
  const message = main.messages.at(-1);
  assert.equal(message?.role, 'notice');
  assert.deepEqual(message?.origin, { kind: 'system' });
  assert.equal(message?.text, NOTICE.text);
  assert.equal(message?.summary, NOTICE.brief);
  assert.ok(h.events.some((event) => event.type === 'line_message' && event.message.role === 'notice'));
  assert.equal(main.messages.some((item) => item.role === 'user'), false);
});

test('Subsequent user message shows prior notice labeled as system, not user speech', async () => {
  const h = await harness();
  h.kernel.notice(NOTICE);
  let seen = '';
  h.respond([(context) => {
    const notice = context.messages.find((message) => message.role === 'user' && typeof message.content === 'string'
      && message.content.includes('系统通知'));
    seen = notice?.role === 'user' && typeof notice.content === 'string' ? notice.content : '';
    return fauxAssistantMessage('看到了。');
  }]);
  h.kernel.send('main', { text: '刚才那条是什么' });
  await h.kernel.settled();
  assert.match(seen, /这不是用户说的/);
  assert.match(seen, /资料交接/);
});

test('Running main line injects notice into active turn after current tool results', async () => {
  const gate = deferred<string>();
  const started: string[] = [];
  const h = await harness({ tools: [slowTool(() => gate.promise, started)] });
  let seen = false;
  h.respond([
    fauxAssistantMessage([fauxToolCall('slow', { what: '查一下' }, { id: 'w' })], { stopReason: 'toolUse' }),
    (context) => {
      seen = context.messages.some((message) => message.role === 'user' && typeof message.content === 'string'
        && message.content.includes('资料交接'));
      return fauxAssistantMessage('好。');
    },
  ]);
  h.kernel.send('main', { text: '慢慢做' });
  await until(() => started.length === 1, '工具开始');
  h.kernel.notice(NOTICE);
  gate.resolve('做完了');
  await h.kernel.settled();
  assert.equal(seen, true);
  const roles = h.kernel.read('main', 50).messages.map((message) => message.role);
  assert.ok(roles.indexOf('notice') > roles.indexOf('toolResult'), roles.join(','));
});

const LETTER = { key: 'letter:s-1', text: '给你写了一封信：你定的「做梦」，今天信息流里有篇原文能对上。', spaceId: 's-1',
  title: '做梦，有了一组数字' };

test('Incoming letter posts Plasticine notice card without turn; model sees as letter', async () => {
  const h = await harness();
  const view = h.kernel.letter(LETTER);
  assert.equal(view?.role, 'letter');
  assert.deepEqual(view?.letter, { spaceId: 's-1', title: '做梦，有了一组数字' });
  assert.equal(view?.origin, null);
  await h.kernel.settled();
  assert.equal(h.kernel.read('main', 50).line.status, 'idle', '不开一轮');
  assert.equal(h.faux.state.callCount, 0);
  let seen = '';
  h.respond([(context) => {
    const letter = context.messages.find((message) => message.role === 'user' && typeof message.content === 'string'
      && message.content.includes('做梦，有了一组数字'));
    seen = letter?.role === 'user' && typeof letter.content === 'string' ? letter.content : '';
    return fauxAssistantMessage('嗯。');
  }]);
  h.kernel.send('main', { text: '那封信我看了' });
  await h.kernel.settled();
  assert.match(seen, /你给他写了一封信《做梦，有了一组数字》（空间 s-1）/);
  assert.match(seen, /这不是用户说的/);
});
