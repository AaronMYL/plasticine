// 通知全部改成主线上的一条消息（《优化清单》第 12 条，他 11-06 定）：来源记成系统，不冒充他说的话；不开一轮；
// 主线正在跑时插进这一轮（不拆开一组工具调用和结果），模型看得到，知道这不是他说的。

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

test('主线空着：写一条系统来源的通知消息，不开一轮、不冒充他说的话', async () => {
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

test('之后他说一句：模型看到通知，标明是系统通知、不是他说的', async () => {
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

test('主线正在跑：通知插进这一轮，排在这一步的工具结果之后', async () => {
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
