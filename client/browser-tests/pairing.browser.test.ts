// 两个独立浏览器上下文走真配对接口；不用账户、模型或外网。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { pairingCodeHash } from '../../agent/src/app/pairing-code.ts';
import { pair } from '../../agent/tests/app/helpers.ts';
import { button, capture, click, fill, key, settle, startStack, text, until } from './helpers.ts';

const INVITE = `document.querySelector('[aria-label="添加设备"]')`;

// 配对码 11-08 已去掉，这两条先跳过；整个文件删不删等 Aaron 定（11-13）。
const SKIP = '配对码 11-08 已去掉';

test('设备邀请：新设备确认前不登记；当前邀请使用后两端成功，其他设备出现不能误判', { skip: SKIP }, async (t) => {
  const { app, page, browser, base } = await startStack(t, { realClock: true, hash: '/settings/system',
    plugins: [{ name: 'pairing-invitation-latency', configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.method === 'POST' && req.url === '/v2/devices/pairing-codes') setTimeout(next, 1200);
        else next();
      });
    } }] });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until(page, button('添加设备'), '添加设备入口');
  await page.evaluate(`${button('添加设备')}.focus()`);
  await click(page, '添加设备');
  await until(page, text('正在生成配对邀请', INVITE), '邀请生成中的状态');
  assert.equal(await page.evaluate(`(() => {
    const main = document.querySelector('.shell-main-area').getBoundingClientRect();
    const sheet = ${INVITE}.getBoundingClientRect();
    return Math.abs(sheet.top - main.top - 16) < 1 && Math.abs(sheet.bottom - main.bottom + 16) < 1
      && Math.abs(sheet.right - main.right + 16) < 1 && sheet.width === 560;
  })()`), true, '邀请面板沿主区右侧展开，避开居中设置弹框的尺寸限制');
  await key(page, 'Tab');
  assert.equal(await page.evaluate(`${INVITE}.contains(document.activeElement)`), true, '焦点留在顶层邀请中');
  await capture(page, 'pairing-generating-mac');
  await until(page, `document.querySelector('[aria-label="备用配对码"]')`, '已生成真实配对码');
  const code = await page.evaluate<string>(`document.querySelector('[aria-label="备用配对码"]').textContent.trim()`);
  const invitation = app.state.pairingCodes.findByHash(pairingCodeHash(code));
  assert.ok(invitation !== undefined);
  assert.equal(invitation.usedAt, null);
  // 本地 fixture 没有加入公共网络，不能把 127.0.0.1 冒充手机可扫码的地址。
  assert.equal(await page.evaluate(`Boolean(document.querySelector('.device-pair-qr'))`), false);
  await capture(page, 'pairing-waiting-local-mac');
  const before = app.state.devices.list().length;
  const fragment = `/pair?${new URLSearchParams({ code, expires: invitation.expiresAt })}`;
  const phone = await browser.page(`${base}/browser-tests/fixtures/app.html#${fragment}`, 'phone', { isolated: true });
  await until(phone, text('连接到 Plasticine'), '新手机确认页');
  assert.equal(await phone.evaluate('location.hash'), '#/today', '邀请在解析后从当前历史项移走');
  assert.equal(app.state.devices.list().length, before, '打开邀请不会自动登记设备');
  await fill(phone, '.login input', '我的 iPhone');
  await capture(phone, 'pairing-confirm-phone');
  await pair(app, '另一个邀请连上的设备');
  await pause(2200);
  assert.equal(await page.evaluate(text('等待新设备确认', INVITE)), true);
  assert.equal(await page.evaluate(text('新设备已连接', INVITE)), false);
  await click(phone, '连接这台手机');
  await until(phone, text('这台手机已连接'), '手机收到真实配对回执');
  await until(page, text('新设备已连接', INVITE), '原设备只认本邀请成功');
  assert.equal(await page.evaluate(text('我的 iPhone', INVITE)), true);
  const used = app.state.pairingCodes.get(invitation.id);
  assert.ok(used !== undefined && used.usedAt !== null && used.deviceId !== null);
  const deviceId = used.deviceId;
  await settle(() => app.state.devices.get(deviceId)?.name === '我的 iPhone', '正确设备落库');
  await capture(page, 'pairing-connected-mac');
  await capture(phone, 'pairing-connected-phone');
  await click(phone, '打开 Plasticine');
  await until(phone, `!document.querySelector('.login')`, '进入已登录应用');
  await click(page, '完成', INVITE);
  await until(page, `!${INVITE}`, '原设备收起邀请');
  assert.equal(await page.evaluate(`document.activeElement?.textContent.trim()`), '添加设备', '焦点回到入口');
  await until(page, text('我的 iPhone', `document.querySelector('[aria-label="已配对的设备"]')`), '列表刷新');
});

test('设备邀请过期：原设备据服务端状态重领，新设备显示过期并可改用备用码', { skip: SKIP }, async (t) => {
  const { app, page, browser, base } = await startStack(t, { realClock: true, hash: '/settings/system' });
  await click(page, '添加设备');
  await until(page, `document.querySelector('[aria-label="备用配对码"]')`, '邀请生成');
  const code = await page.evaluate<string>(`document.querySelector('[aria-label="备用配对码"]').textContent.trim()`);
  const invitation = app.state.pairingCodes.findByHash(pairingCodeHash(code));
  assert.ok(invitation !== undefined);
  app.clock.advance(Date.parse(invitation.expiresAt) - app.clock.now().getTime() + 1000);
  await until(page, text('配对邀请已过期', INVITE), '服务端确认过期');
  await capture(page, 'pairing-expired-mac');
  const hash = `/pair?${new URLSearchParams({ code, expires: '2020-01-01T00:00:00.000Z' })}`;
  const phone = await browser.page(`${base}/browser-tests/fixtures/app.html#${hash}`, 'phone', { isolated: true });
  await until(phone, text('配对邀请已过期'), '过期邀请的手机页面');
  await capture(phone, 'pairing-expired-phone');
  await click(phone, '输入新的配对码');
  await until(phone, `document.querySelector('input[autocomplete="one-time-code"]')`, '备用码表单');
  await click(page, '重新生成', INVITE);
  await until(page, `document.querySelector('[aria-label="备用配对码"]')?.textContent.trim() !== ${JSON.stringify(code)}
    && Boolean(document.querySelector('[aria-label="备用配对码"]'))`, '新邀请代替过期邀请');
  await key(page, 'Escape');
  await until(page, `!${INVITE}`, 'Esc 先关邀请');
  assert.equal(await page.evaluate(`Boolean(document.querySelector('.settings-dialog'))`), true, '设置保持打开');
});
