import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOOD_CALLBACK } from '../../agent/tests/kernel/helpers.ts';
import { button, capture, click, fill, key, layouts, settle, startStack, text, until } from './helpers.ts';
import { reloadPage } from './reload.ts';

const DIALOG = `document.querySelector('[role="region"][aria-label="对话"]') ?? document`;
const COMPOSER = `document.querySelector('textarea[aria-label="问一句"]')`;

async function say(page: Parameters<typeof fill>[0], words: string): Promise<void> {
  await fill(page, 'textarea[aria-label="问一句"]', words);
  await page.evaluate(`${COMPOSER}.focus()`);
  await key(page, 'Enter');
}

test('Web model connect: enters home unlinked, link prompt, sub callback, hides key', async (t) => {
  const { page, kernel, app } = await startStack(t, { kernel: { connected: false }, realClock: true,
    client: 'web' });
  assert.ok(kernel !== null);
  await page.evaluate(`window.open = (url) => { window.__opened = String(url); return null; }`);
  await until(page, text('连上模型后，定时的事才会跑', '.shell-main [aria-label="等你"]'), '首页提醒去连');
  await click(page, '去连', `document.querySelector('.shell-main [aria-label="等你"]')`);
  const sheet = `document.querySelector('.connect-sheet')`;
  await until(page, `${sheet}?.querySelector('.provider-more-row')`, '小窗里「其他 n 家」');
  await page.evaluate(`${sheet}.querySelector('.provider-more-row').click()`);
  await click(page, '登录', `(${sheet}).querySelector('[aria-label="Fake 订阅"]')`);
  await until(page, text('在浏览器里登录', sheet), '等浏览器授权');
  await until(page, `window.__opened?.startsWith('https://auth.fake.test/')`, '打开了授权页');
  await capture(page, 'connect-login');
  await fill(page, '.connect-sheet input[aria-label="回调地址"]', GOOD_CALLBACK);
  await click(page, '继续', sheet);
  await settle(() => kernel.models.credentials.connectedType('fake-sub') === 'oauth', '真服务端存了登录');
  await until(page, `!document.querySelector('.connect-sheet')`, '连上后小窗关掉');
  await until(page, `!(${text('连上模型后，定时的事才会跑')})`, '首页那条提醒没了');

  await page.evaluate(`location.hash = '#/settings/ai'`);
  await click(page, '添加提供商', `document.querySelector('.settings-dialog')`);
  const adding = `document.querySelector('.settings-dialog [aria-label="添加提供商"][role="region"]')`;
  await until(page, adding, '设置里的提供商');
  await page.evaluate(`${adding}.querySelector('.provider-more, .provider-more-row')?.click()`);
  await click(page, '填 key', `(${adding}).querySelector('[aria-label="Fake Key"]')`);
  await fill(page, '.settings-dialog .settings-connect input[type="password"]', 'key-value-for-browser-tests');
  await click(page, '连接', `document.querySelector('.settings-dialog')`);
  await settle(() => kernel.models.credentials.connectedType('fake-key') === 'api_key', '真服务端存了 key');
  await until(page, `!document.querySelector('.settings-dialog .settings-connect input[type="password"]')`,
    'key 表单收起');
  assert.equal(await page.evaluate(text('key-value-for-browser-tests')), false, '页面不回显 key');
  await reloadPage(page);
  const connected = `document.querySelector('.settings-dialog [aria-label="连着的提供商"]')`;
  await until(page, `${connected}?.querySelector('[aria-label="Fake Key"]')`, '刷新后连着的里有这一家');
  assert.equal(await page.evaluate(text('key-value-for-browser-tests')), false);
  await layouts(page, 'settings-ai', '.settings-dialog', true);
  assert.equal(app.requests.length, 0, '连模型不调旧大脑');
});

test('Main line: single status row, send-now/withdraw queue, pause survives reload', async (t) => {
  const { page, kernel, app } = await startStack(t, { kernel: { connected: true }, realClock: true,
    hash: '/messages/plasticine' });
  assert.ok(kernel !== null);
  await until(page, `${COMPOSER}`, '输入框');
  await say(page, '帮我查一下 CuaDriver.app');
  await until(page, text('帮我查一下 CuaDriver.app', '.line-scroll'), '我的话在对话里');
  await until(page, text('慢慢做：', '.line-scroll'), '在跑的那一行');
  await settle(() => kernel.gates.started.length === 1, '慢工具开始做');
  assert.equal(await page.evaluate(`document.querySelectorAll('.line-scroll .line-live').length`), 1, '只有一行状态');
  assert.ok(await page.evaluate(`Boolean(document.querySelector('button.line-stop[aria-label="暂停"]'))`),
    '发送键旁有暂停键');

  await say(page, '再看看它有没有开机自启');
  await until(page, `document.querySelector('[aria-label="排队的消息：再看看它有没有开机自启"]')`, '排进输入框');
  await say(page, '这句撤回');
  await until(page, `document.querySelector('[aria-label="排队的消息：这句撤回"]')`, '第二句也排着');
  await click(page, '撤回', `document.querySelector('[aria-label="排队的消息：这句撤回"]')`);
  await until(page, `!document.querySelector('[aria-label="排队的消息：这句撤回"]')`, '撤回了');
  await layouts(page, 'line-running', '.line-composer');
  await click(page, '立即发送', `document.querySelector('[aria-label="排队的消息：再看看它有没有开机自启"]')`);
  await until(page, text('下一步插进去', '[aria-label="排队的消息：再看看它有没有开机自启"]'), '下一步插进去');
  await capture(page, 'line-steering');
  kernel.gates.release(kernel.gates.started[0]!, '/Applications/CuaDriver.app，签名有效');
  await until(page, `!document.querySelector('.line-queue')`, '排队清空');
  await until(page, text('收到：再看看它有没有开机自启', '.line-scroll'), '插进去的话这一轮就答了');
  await until(page, `!document.querySelector('button.line-stop')`, '这一轮做完，暂停键收起');
  assert.equal(await page.evaluate(text('撤回', '.line-scroll')), false, '撤回的那句没发出去');

  await say(page, '再查一下 Cua 组件');
  await settle(() => kernel.gates.started.length === 2, '第二轮开始做');
  await click(page, '暂停');
  await until(page, text('已暂停', '.line-scroll'), '已暂停');
  await until(page, `!document.querySelector('button.line-stop')`, '暂停键收起');
  await say(page, '这句等继续后再做');
  await until(page, `document.querySelector('[aria-label="排队的消息：这句等继续后再做"]')`, '暂停后新话只排队');
  await reloadPage(page);
  await until(page, text('已暂停', '.line-scroll'), '刷新后仍暂停');
  await until(page, `document.querySelector('[aria-label="排队的消息：这句等继续后再做"]')`, '刷新后排队仍在');
  assert.equal(await page.evaluate(text('收到：这句等继续后再做', '.line-scroll')), false,
    '暂停和刷新都不自动执行排队消息');
  await until(page, button('继续', `document.querySelector('.line-scroll')`), '本人能明确继续');
  await capture(page, 'line-paused');
  assert.equal(app.requests.length, 0, '新内核不走旧大脑');
});

test('Bg line: running pauses; finished expands steps and moves to recent results', async (t) => {
  const { page, kernel } = await startStack(t, { kernel: { connected: true }, realClock: true,
    hash: '/messages/plasticine' });
  assert.ok(kernel !== null);
  await until(page, `${COMPOSER}`, '输入框');
  await say(page, '后台查一下它的安装来源');
  const card = `document.querySelector('[aria-label="线：查 CuaDriver 的安装来源"]')`;
  await until(page, card, '后台线卡片');
  await until(page, text('开了一条后台线去查', '.line-scroll'), '主线先答一句');
  await settle(() => kernel.gates.started.includes('安装来源'), '后台线开始做');
  await until(page, button('暂停', card), '在跑的卡片能暂停');
  await until(page, `document.querySelector('[aria-label="首页"], .sidebar')`, '壳在');
  await capture(page, 'line-background-running');
  kernel.gates.release('安装来源', '官方 GitHub 发布页下载，签名 Cua AI, Inc.');
  await until(page, `!(${button('暂停', card)})`, '做完不再能暂停');
  const fold = `Array.from(${card}?.querySelectorAll('button') ?? [])
    .find(node => /^做了 \\d+ 步/.test(node.textContent.trim()))`;
  await until(page, fold, '做完的卡片有「做了 n 步」');
  await page.evaluate(`${fold}.click()`);
  await until(page, text('慢慢做：安装来源', card), '展开后一步一行');

  await page.evaluate(`location.hash = '#/today'`);
  await until(page, `document.querySelector('.shell-main h1')`, '首页');
  await until(page, text('查 CuaDriver 的安装来源', '.shell-main [aria-label="新的"]'), '已完成工作在「新的」');
  assert.equal(await page.evaluate(`Boolean(${text('查 CuaDriver 的安装来源', '.shell-main [aria-label="在做"]')})`), false,
    '做完的线不在「在做」');
  await until(page, `${DIALOG}`, '对话框');
});
