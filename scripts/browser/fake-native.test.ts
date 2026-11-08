import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Value } from 'typebox/value';
import { WebPageSnapshotSchema, WindowChromeSchema } from '../../agent/shared/api/mac-bridge.ts';
import { WebCircleResultSchema, WebPageImageSchema, WEB_PAGE_TOOLS } from '../../agent/shared/api/web-page-tools.ts';
import { LoginImportResultSchema, LoginSourcesSchema, SiteLoginsSchema } from '../../agent/shared/api/mac-logins.ts';
import { clientProfile, plistVersion, supportedTools } from './client-profile.ts';
import { fakeNativeConfig, fakeNativeScript, nativeCallProblem, type FakeNativeRecord,
  type NativeCall } from './fake-native.ts';

interface Host {
  plasticineDesktop?: Record<string, unknown> & { webTabs: Record<string, (...args: unknown[]) => unknown> };
  plasticineIOS?: Record<string, unknown> & { webTabs: Record<string, (...args: unknown[]) => unknown> };
  __plasticineFakeNative: FakeNativeRecord;
  __plasticineWebTabEvent?: (event: unknown) => void;
}

function install(client: 'mac'): Host {
  const config = fakeNativeConfig(clientProfile(client));
  assert.ok(config !== null);
  const window = {} as Host;
  runInNewContext(fakeNativeScript(config), { window, setTimeout, JSON, Promise, Set, Object });
  return window;
}

test('Mac 的身份从原生源码读：版本号进 User-Agent，网页工具和 Swift 报的一样；手机是不带桥的手机浏览器', () => {
  const mac = clientProfile('mac');
  assert.match(mac.userAgent, /(?:^|\s)PlasticineMac\/[0-9.]+$/);
  assert.equal(mac.width, 1440);
  assert.equal(mac.touch, false);
  assert.ok(mac.tools.includes('downloads'));
  const phone = clientProfile('phone');
  assert.equal(phone.native, null);
  assert.doesNotMatch(phone.userAgent, /Plasticine/);
  assert.deepEqual([phone.width, phone.height, phone.touch, phone.mobile], [390, 844, true, true]);
  const web = clientProfile('web');
  assert.equal(web.native, null);
  assert.doesNotMatch(web.userAgent, /Plasticine/);
});

test('原生源码的版本号和工具清单按格式读，报了网页侧不认识的工具就报错', () => {
  assert.equal(plistVersion('<key>CFBundleShortVersionString</key>\n\t<string>0.4.0</string>'), '0.4.0');
  assert.deepEqual(supportedTools('static let supported = ["find", "zoom"]'), ['find', 'zoom']);
  assert.throws(() => supportedTools('static let supported = ["find", "teleport"]'), /teleport/);
  assert.throws(() => plistVersion('<plist/>'), /CFBundleShortVersionString/);
});

test('模拟原生回的快照、截图、圈一块、窗口外观都合共享 schema', () => {
  const config = fakeNativeConfig(clientProfile('mac'));
  assert.ok(config !== null);
  assert.ok(Value.Check(WebPageImageSchema, config.image));
  assert.ok(Value.Check(WebCircleResultSchema, config.circle));
  assert.ok(Value.Check(WindowChromeSchema, config.chrome));
  const known: readonly string[] = WEB_PAGE_TOOLS;
  assert.ok(config.tools.every((tool) => known.includes(tool)));
  assert.ok(Buffer.from(config.image.base64, 'base64').subarray(1, 4).equals(Buffer.from('PNG')));
});

test('注入脚本装好 Mac 桥：记下每次调用，快照合协议，新标签回一次状态', async () => {
  const host = install('mac');
  const mac = host.plasticineDesktop;
  assert.ok(mac !== undefined);
  assert.equal(host.plasticineIOS, undefined);
  const events: unknown[] = [];
  host.__plasticineWebTabEvent = (event) => events.push(event);
  const sync = { tabs: [{ tabId: 't1', url: 'https://blog.example.org/local-first-sync' }], active: 't1',
    frame: { x: 0, y: 0, width: 800, height: 600 }, hitRegions: [] };
  mac.webTabs['sync']?.(sync);
  mac.webTabs['sync']?.(sync);
  const snapshot = await mac.webTabs['snapshot']?.('t1');
  assert.ok(Value.Check(WebPageSnapshotSchema, snapshot));
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(events.length, 1, '同一个标签只报一次载入');
  // 调用记录在注入脚本的那个上下文里建，拷回本上下文再比。
  const calls = Array.from(host.__plasticineFakeNative.calls);
  assert.deepEqual(calls.map((call) => call.method), ['sync', 'sync', 'snapshot']);
  assert.deepEqual(calls.map(nativeCallProblem), [null, null, null]);
});

test('Mac 桥有登录（第 3 批）：网站、来源、导入结果合共享 schema，调用记下来按协议核对；iPhone 没有', async () => {
  const host = install('mac');
  const logins = host.plasticineDesktop?.['logins'] as Record<string, (...args: unknown[]) => unknown> | undefined;
  assert.ok(logins !== undefined);
  assert.ok(Value.Check(SiteLoginsSchema, await logins['sites']?.()));
  assert.ok(Value.Check(LoginSourcesSchema, await logins['sources']?.()));
  assert.ok(Value.Check(LoginImportResultSchema, await logins['import']?.({ from: 'chrome', passwords: false })));
  assert.equal(await logins['forget']?.('x.com'), true);
  logins['openFullDiskAccess']?.();
  const calls = Array.from(host.__plasticineFakeNative.calls);
  assert.deepEqual(calls.map((call) => `${call.channel}.${call.method}`), ['plasticineLogins.sites',
    'plasticineLogins.sources', 'plasticineLogins.import', 'plasticineLogins.forget',
    'plasticineLogins.openFullDiskAccess']);
  assert.deepEqual(calls.map(nativeCallProblem), [null, null, null, null, null]);
});

test('圈一块默认一直等，网页发 circle_cancel 回 null；打开开关后回圈好的一块', async () => {
  const host = install('mac');
  const tool = host.plasticineDesktop?.webTabs['tool'];
  assert.ok(tool !== undefined);
  const waiting = tool('t1', { kind: 'circle' }) as Promise<unknown>;
  await tool('t1', { kind: 'circle_cancel' });
  assert.equal(await waiting, null);
  host.__plasticineFakeNative.circleAnswers = true;
  const answered = await (tool('t1', { kind: 'circle' }) as Promise<unknown>);
  assert.ok(Value.Check(WebCircleResultSchema, answered));
});

test('协议外的调用逐条说出原因：同步缺字段、未知命令、未知工具、iPhone 不认识的原生页', () => {
  const cases: [NativeCall, RegExp][] = [
    [{ channel: 'plasticineTabs', method: 'sync', args: [{ tabs: [] }] }, /active|frame/],
    [{ channel: 'plasticineTabs', method: 'command', args: ['t1', 'teleport'] }, /back/],
    [{ channel: 'plasticineTabs', method: 'tool', args: ['t1', { kind: 'teleport' }] }, /./],
    [{ channel: 'plasticine', method: 'open', args: ['camera'] }, /settings/],
    [{ channel: 'plasticineTabs', method: 'reload', args: [] }, /桥上没有/],
    [{ channel: 'plasticineChrome', method: 'titlebar', args: [{ height: 44 }] }, /noDrag|layout/],
    [{ channel: 'plasticineLogins', method: 'import', args: [{ from: 'firefox', passwords: false }] }, /from/],
    [{ channel: 'plasticineLogins', method: 'forget', args: [''] }, /非空/],
  ];
  for (const [call, reason] of cases) {
    assert.match(nativeCallProblem(call) ?? '', reason, `${call.channel}.${call.method}`);
  }
  assert.equal(nativeCallProblem({ channel: 'plasticineTranslate', method: 'configure', args: ['t1', null] }), null);
});
