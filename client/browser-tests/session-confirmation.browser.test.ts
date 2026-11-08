// 真 App + HTTP：配对后直接读自己的笔记；没有额外钥匙、解锁按钮或后台自动解锁请求。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Plugin } from 'vite';
import { SIGNATURE_HEADER, SIGNED_AT_HEADER } from '../../agent/shared/api/index.ts';
import type { TestApp } from '../../agent/tests/app/helpers.ts';
import type { Cdp } from '../../scripts/browser/cdp.ts';
import type { ClientName } from '../../scripts/browser/client-profile.ts';
import { click, startStack, text, until } from './helpers.ts';
import { reloadPage } from './reload.ts';

// 越过原来只允许新配对设备登记钥匙的十分钟窗口，避免新会话掩盖问题。
const OLD_SESSION_MS = 11 * 60_000;
const REQUEST_LOG = 'session-confirmation-requests';
const SETTINGS = `document.querySelector('.settings-dialog')`;
const TITLE = '阅读随记';
const HISTORY = '读完一章后，写下最想继续追问的问题。';
const CONTENT = '下次翻到这里，就从这句话接着想。';
const PROFILES = ['mac', 'phone'] as const;

interface ObservedRequest {
  path: string;
  method: string;
  requestId: string | null;
  signed: boolean;
  status: number | null;
}

/** 只撤掉浏览器能力、记录请求；所有业务响应仍来自临时真实服务，不拦截或替换响应。 */
function withoutSigning(): Plugin {
  return { name: 'confirmation-without-signing', transformIndexHtml: () => [{
    tag: 'script', injectTo: 'head-prepend', children: `(() => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
      Object.defineProperty(crypto, 'subtle', { configurable: true, value: undefined });
      const key = ${JSON.stringify(REQUEST_LOG)};
      const read = () => JSON.parse(sessionStorage.getItem(key) || '[]');
      const send = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : String(input), location.href).pathname;
        const observed = path.startsWith('/v2/device-keys') || path.endsWith('/unlock')
          || path === '/v2/nodes/pairing-codes';
        if (!observed) return send(input, init);
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const entries = read();
        const index = entries.length;
        entries.push({ path, method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
          requestId: body.requestId ?? null,
          signed: headers.has(${JSON.stringify(SIGNATURE_HEADER)}) || headers.has(${JSON.stringify(SIGNED_AT_HEADER)}),
          status: null });
        sessionStorage.setItem(key, JSON.stringify(entries));
        const response = await send(input, init);
        const completed = read();
        completed[index].status = response.status;
        sessionStorage.setItem(key, JSON.stringify(completed));
        return response;
      };
    })()`,
  }] };
}

function sessionFor(app: TestApp, cookie: string) {
  const token = cookie.slice(cookie.indexOf('=') + 1);
  const session = app.state.sessions.findByTokenHash(createHash('sha256').update(token).digest('hex'));
  assert.ok(session, '真实配对得到的会话保存在服务端');
  return session;
}

async function observed(page: Cdp): Promise<ObservedRequest[]> {
  return page.evaluate(`JSON.parse(sessionStorage.getItem(${JSON.stringify(REQUEST_LOG)}) || '[]')`);
}

async function noKeyRequirement(page: Cdp, app: TestApp, deviceId: string): Promise<void> {
  assert.equal(await page.evaluate('typeof indexedDB'), 'undefined', '确实没有 IndexedDB');
  assert.equal(await page.evaluate('typeof crypto.subtle'), 'undefined', '确实没有 WebCrypto 签名能力');
  assert.equal(app.state.deviceKeys.liveFor(deviceId), undefined, '服务端仍未登记公钥');
  assert.deepEqual((await observed(page)).filter((entry) => entry.path.startsWith('/v2/device-keys')), [],
    '正常业务和刷新都不请求钥匙接口');
  assert.deepEqual((await observed(page)).filter((entry) => entry.path.endsWith('/unlock')), [],
    '直接读取不发送解锁请求，也不靠后台偷偷解锁实现');
  assert.equal(await page.evaluate(`document.querySelector('.signing-notice') !== null`), false,
    '页面没有额外钥匙提示');
}

async function available(page: Cdp, label: string): Promise<void> {
  const found = `Array.from(document.querySelectorAll('button')).find(node =>
    node.getClientRects().length > 0 && node.textContent.trim() === ${JSON.stringify(label)})`;
  await until(page, `(${found}) !== undefined`, `已经展示「${label}」`);
  assert.equal(await page.evaluate(`(${found}).disabled`), false, `已配对会话可直接「${label}」`);
}

async function evidence(page: Cdp, client: ClientName, stage: string): Promise<void> {
  const directory = process.env['PLASTICINE_PRIVATE_NOTES_EVIDENCE'];
  if (directory === undefined) return;
  await mkdir(directory, { recursive: true });
  if (client === 'mac' && stage === 'note-open') {
    await click(page, '缩小对话框');
  }
  // 验收看动作所在的区域；等字体和有限入场动效结束，避免截到半透明的弹层。
  await page.evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const entering = document.getAnimations().filter(animation =>
      Number.isFinite(animation.effect?.getComputedTiming().endTime));
    await Promise.allSettled(entering.map(animation => animation.finished));
  })()`);
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await page.evaluate('document.documentElement.scrollWidth > innerWidth'), false,
    `${client} 笔记界面不横向溢出`);
  const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(directory, `${client}-${stage}.png`), Buffer.from(String(shot['data']), 'base64'));
}

async function visitNote(page: Cdp, id: string): Promise<void> {
  await page.evaluate(`location.hash = ${JSON.stringify(`#/notes/${id}`)}`);
  await until(page, `document.querySelector('.note-pane .ProseMirror') !== null
    || ${text('确认解锁', '.note-pane')}`, '笔记请求已完成');
  assert.equal(await page.evaluate(text('确认解锁', '.note-pane')), false, '配对后不应再有确认解锁关卡');
  await until(page, text(CONTENT, '.note-body .ProseMirror'), '直接显示私密正文');
}

for (const client of PROFILES) {
  test(`${client}：配对后直接读私密正文、历史和备份预览，刷新也不需要解锁`, async (t) => {
    let noteId = '';
    let backupId = '';
    const { app, page, cookie } = await startStack(t, { client, hash: '/notes', realClock: true,
      plugins: [withoutSigning()], beforeOpen(testApp) {
        const note = testApp.state.notes.create({ markdown: `# ${TITLE}\n\n${HISTORY}`,
          folder: '笔记', author: 'user', private: true });
        noteId = note.id;
        const backup = testApp.state.backups.begin(`private-browser-${client}`, 'manual');
        testApp.state.backups.complete(backup.id);
        backupId = backup.id;
        testApp.state.notes.save(noteId, note.version, { markdown: `# ${TITLE}\n\n${HISTORY}\n\n${CONTENT}` });
        testApp.clock.advance(OLD_SESSION_MS);
      } });
    await until(page, 'document.querySelector(".shell-main") !== null', '旧的本人会话直接打开应用');
    const session = sessionFor(app, cookie);
    assert.ok(app.clock.now().getTime() - Date.parse(session.createdAt) >= OLD_SESSION_MS);
    assert.equal(await page.evaluate('matchMedia("(pointer: coarse)").matches'), client === 'phone',
      '手机使用触屏网页身份，电脑使用 Mac App 身份');
    await noKeyRequirement(page, app, session.deviceId);

    await visitNote(page, noteId);
    assert.equal(await page.evaluate(`/解锁|钥匙|签名/.test(document.querySelector('.note-pane').textContent)`), false);
    assert.equal(app.state.notes.require(noteId).private, true, '保留私密分类，不用改为公开来实现读取');
    assert.equal(await page.evaluate(text(TITLE, '.note-pane')), true, '直接显示真实标题');
    await noKeyRequirement(page, app, session.deviceId);
    await evidence(page, client, 'note-open');

    await click(page, '更多笔记操作');
    await click(page, '版本历史');
    await click(page, '查看第 1 版');
    await until(page, text(HISTORY, '[aria-label="历史正文"]'), '直接读取历史正文');
    assert.equal(await page.evaluate(text('确认解锁')), false);
    await evidence(page, client, 'note-history');
    await click(page, '关掉笔记版本');

    await reloadPage(page);
    await until(page, text(CONTENT, '.note-body .ProseMirror'), '刷新后直接读取私密正文');
    await noKeyRequirement(page, app, session.deviceId);
    await page.evaluate(`location.hash = '#/settings/system'`);
    await click(page, '添加设备', SETTINGS);
    const mac = `Array.from(document.querySelectorAll('summary')).find(node =>
      node.textContent.trim() === '连接 Mac 执行节点')`;
    await until(page, `(${mac}) !== undefined`, '展开已有的 Mac 节点入口');
    await page.evaluate(`(${mac}).click()`);
    await available(page, '生成 Mac 专用码');
    await click(page, '生成 Mac 专用码');
    await until(page, `document.querySelector('.device-pair-mac [role="status"] .mono')
      ?.textContent.trim().length === 9`, '真实服务返回 Mac 节点专用码');
    const issued = (await observed(page)).find((entry) => entry.path === '/v2/nodes/pairing-codes');
    assert.ok(issued);
    assert.equal(issued.status, 201);
    assert.equal(issued.signed, false);
    const receipt = app.state.apiRequests.find(issued.requestId ?? '');
    assert.equal(receipt?.deviceId, session.deviceId);
    assert.ok(typeof receipt?.body === 'object' && receipt.body !== null && 'codeId' in receipt.body);
    const code = app.state.nodePairingCodes.get(String(receipt.body.codeId));
    assert.equal(code?.issuedByDeviceId, session.deviceId, '领码来源是实际本人设备');
    await noKeyRequirement(page, app, session.deviceId);
    await click(page, '关掉添加设备');
    await click(page, '全部备份', SETTINGS);
    await click(page, '校验与恢复');
    await click(page, `预览恢复 ${TITLE}`);
    await until(page, `document.querySelector('.backup-restore-card') !== null`, '直接打开私密备份预览');
    await until(page, `document.querySelector('.settings-dialog') === null`, '设置已收起，不遮挡恢复预览');
    await until(page, text(CONTENT, '.backup-restore-card'), '预览显示当前正文');
    assert.equal(await page.evaluate(text(HISTORY, '.backup-restore-card')), true, '预览显示备份正文');
    assert.equal(await page.evaluate(text('确认解锁')), false, '备份读取也没有额外解锁');
    assert.equal(app.state.notes.require(noteId).version, 2, '读取和预览没有实际恢复笔记');
    assert.equal(app.state.backups.require(backupId).status, 'ready');
    await noKeyRequirement(page, app, session.deviceId);
    await evidence(page, client, 'backup-preview');
  });
}

async function setCookie(page: Cdp, cookie: string, base: string): Promise<void> {
  const [name, value] = cookie.split(';')[0]!.split('=');
  await page.send('Network.setCookie', { name, value, url: base });
}

async function deniedWrite(page: Cdp, path: string, requestId: string): Promise<{ status: number; code: string }> {
  return page.evaluate(`fetch(${JSON.stringify(path)}, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: ${JSON.stringify(requestId)} })
  }).then(async response => ({ status: response.status, code: (await response.json()).code }))`);
}

test('本实例系统浏览器可直接读私密笔记且仍是系统来源，撤销后不能继续读取', async (t) => {
  let noteId = '';
  const { app, page, cookie, base } = await startStack(t, { hash: '/notes', plugins: [withoutSigning()],
    beforeOpen(testApp) {
      noteId = testApp.state.notes.create({ markdown: CONTENT, folder: '笔记', author: 'user', private: true }).id;
      testApp.clock.advance(OLD_SESSION_MS);
    } });
  await until(page, 'document.querySelector(".shell-main") !== null', '已配对页面可用');
  const user = sessionFor(app, cookie);
  const system = app.app.deps.browserSessions.open();
  await setCookie(page, system.cookie, base);
  await reloadPage(page);
  await until(page, 'document.querySelector(".shell-main") !== null', '系统浏览器正常打开页面');
  assert.equal(await page.evaluate(`fetch('/v2/session').then(response => response.json()).then(value => value.actor)`),
    'system');
  await visitNote(page, noteId);
  assert.equal(await page.evaluate(`fetch(${JSON.stringify(`/v2/notes/${noteId}/versions/1`)})
    .then(response => response.status)`), 200, '历史版本也直接可读');
  const targets = ['/v2/nodes/pairing-codes'];
  for (const [index, path] of targets.entries()) {
    const requestId = `req_system_confirmation_${index}`;
    assert.deepEqual(await deniedWrite(page, path, requestId), { status: 403, code: 'user_confirmation_required' });
    assert.equal(app.state.apiRequests.find(requestId), undefined, '系统输入不记成本人确认');
  }
  assert.equal(await page.evaluate(`fetch(${JSON.stringify(`/v2/notes/${noteId}`)})
    .then(response => response.status)`), 200, '本实例系统浏览器沿普通笔记的认证读取');
  assert.equal(app.state.notes.require(noteId).version, 1, '读取不伪造本人修改或确认');
  await noKeyRequirement(page, app, system.device.id);

  app.state.sessions.revoke(user.id, app.clock.now().toISOString());
  await setCookie(page, cookie, base);
  assert.equal(await page.evaluate(`fetch(${JSON.stringify(`/v2/notes/${noteId}`)})
    .then(response => response.status)`), 401, '撤销的会话不能读取正文');
  for (const [index, path] of targets.entries()) {
    const requestId = `req_revoked_confirmation_${index}`;
    const result = await deniedWrite(page, path, requestId);
    assert.equal(result.status, 401);
    assert.equal(app.state.apiRequests.find(requestId), undefined, '撤销的会话不产生确认回执');
  }
  await reloadPage(page);
  await until(page, text('配对这台设备'), '撤销后刷新回到配对页');
  assert.equal(await page.evaluate(text(CONTENT)), false, '撤销后不展示私密正文');
  await noKeyRequirement(page, app, user.deviceId);
});
