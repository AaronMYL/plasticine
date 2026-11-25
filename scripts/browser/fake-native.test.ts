import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Value } from 'typebox/value';
import { WebPageSnapshotSchema, WindowChromeSchema } from '../../agent/shared/api/mac-bridge.ts';
import { WebCircleResultSchema, WebPageImageSchema, WEB_PAGE_TOOLS } from '../../agent/shared/api/web-page-tools.ts';
import { LoginImportResultSchema, LoginSourcesSchema, SiteLoginsSchema } from '../../agent/shared/api/mac-logins.ts';
import { clientProfile } from './client-profile.ts';
import { fakeNativeConfig, fakeNativeScript, nativeCallProblem, type FakeNativeRecord,
  type NativeCall } from './fake-native.ts';

interface Host {
  plasticineDesktop?: Record<string, unknown> & { webTabs: Record<string, (...args: unknown[]) => unknown> };
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

test('Mac uses PlasticineDesktop UA with full shell web tools; mobile simulates plain mobile browser', () => {
  const mac = clientProfile('mac');
  assert.match(mac.userAgent, /(?:^|\s)PlasticineDesktop\/[0-9.]+$/);
  assert.deepEqual(mac.tools, [...WEB_PAGE_TOOLS]);
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

test('mock native snapshot, screenshot, circle region, and window appearance match shared schemas', () => {
  const config = fakeNativeConfig(clientProfile('mac'));
  assert.ok(config !== null);
  assert.ok(Value.Check(WebPageImageSchema, config.image));
  assert.ok(Value.Check(WebCircleResultSchema, config.circle));
  assert.ok(Value.Check(WindowChromeSchema, config.chrome));
  const known: readonly string[] = WEB_PAGE_TOOLS;
  assert.ok(config.tools.every((tool) => known.includes(tool)));
  assert.ok(Buffer.from(config.image.base64, 'base64').subarray(1, 4).equals(Buffer.from('PNG')));
});

test('injected Mac bridge records calls, validates snapshots, and emits tab state on new tab', async () => {
  const host = install('mac');
  const mac = host.plasticineDesktop;
  assert.ok(mac !== undefined);
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
  const calls = Array.from(host.__plasticineFakeNative.calls);
  assert.deepEqual(calls.map((call) => call.method), ['sync', 'sync', 'snapshot']);
  assert.deepEqual(calls.map(nativeCallProblem), [null, null, null]);
});

test('Mac bridge logins (batch 3) match shared schema for sites, sources, imports, and call checks', async () => {
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

test('circle region waits until circle_cancel returns null or returns region when enabled', async () => {
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

test('reports exact reason for out-of-protocol calls: missing sync field, unknown cmd/tool/method', () => {
  const cases: [NativeCall, RegExp][] = [
    [{ channel: 'plasticineTabs', method: 'sync', args: [{ tabs: [] }] }, /active|frame/],
    [{ channel: 'plasticineTabs', method: 'command', args: ['t1', 'teleport'] }, /back/],
    [{ channel: 'plasticineTabs', method: 'tool', args: ['t1', { kind: 'teleport' }] }, /./],
    [{ channel: 'plasticine', method: 'open', args: ['camera'] }, /桥上没有/],
    [{ channel: 'plasticineTabs', method: 'reload', args: [] }, /桥上没有/],
    [{ channel: 'plasticineLogins', method: 'import', args: [{ from: 'firefox', passwords: false }] }, /from/],
    [{ channel: 'plasticineLogins', method: 'forget', args: [''] }, /非空/],
  ];
  for (const [call, reason] of cases) {
    assert.match(nativeCallProblem(call) ?? '', reason, `${call.channel}.${call.method}`);
  }
  assert.equal(nativeCallProblem({ channel: 'plasticineTranslate', method: 'configure', args: ['t1', null] }), null);
});

test('web extract mock bridge returns images array and accepts highlight/scroll without faking DOM', async () => {
  const host = install('mac');
  const tabs = host.plasticineDesktop!.webTabs;
  assert.deepEqual(JSON.parse(JSON.stringify(await tabs['tool']?.('t1', { kind: 'extract_images' }))), []);
  const result = await tabs['tool']?.('t1', { kind: 'extract_marks',
    points: [{ quote: '正文', context: '正文' }], focus: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { marked: 1 });
  assert.deepEqual(Array.from(host.__plasticineFakeNative.calls).map(nativeCallProblem), [null, null]);
});
