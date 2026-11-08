import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { desktopPaths } from '../src/app/desktop-paths.ts';
import { initialChoice, LOCAL_SERVER_URL, normalizeRemoteUrl, RemoteUrlError, sameOrigin,
  targetUrl } from '../src/app/server-target.ts';
import { defaultSettings, SettingsStore } from '../src/app/settings-store.ts';
import { tempDir } from './helpers.ts';

test('Mac 上本体数据接着 Swift 版的目录，Electron 的网页数据单放', () => {
  const paths = desktopPaths('darwin', { home: '/Users/you' });
  assert.equal(paths.serverState, '/Users/you/Library/Application Support/Plasticine/server');
  assert.equal(paths.userData, '/Users/you/Library/Application Support/Plasticine/Desktop');
  assert.equal(paths.legacyCredentials, '/Users/you/Library/Application Support/Plasticine/node-credential');
  assert.equal(paths.logs, '/Users/you/Library/Logs/Plasticine');
});

test('Windows 上本体数据接着托盘版的 %LOCALAPPDATA%\\Plasticine\\state', () => {
  const paths = desktopPaths('win32', { home: 'C:\\Users\\a', localAppData: 'C:\\Users\\a\\AppData\\Local' });
  assert.equal(paths.serverState, 'C:\\Users\\a\\AppData\\Local\\Plasticine\\state');
  assert.equal(paths.logs, 'C:\\Users\\a\\AppData\\Local\\Plasticine\\logs');
});

test('第一次打开：新装默认这台电脑，装过的照旧远程，没带本体只能远程，Swift 版选过的接着用', () => {
  assert.deepEqual(initialChoice({ bundled: true, priorInstall: false, legacyRemote: null, legacyMode: null }),
    { mode: 'this_computer', remoteUrl: null });
  assert.deepEqual(initialChoice({ bundled: true, priorInstall: true, legacyRemote: 'https://203.0.113.10/',
    legacyMode: null }), { mode: 'remote', remoteUrl: 'https://203.0.113.10/' });
  assert.equal(initialChoice({ bundled: false, priorInstall: false, legacyRemote: null, legacyMode: 'this_computer' })
    .mode, 'remote');
  assert.equal(initialChoice({ bundled: true, priorInstall: true, legacyRemote: 'http://bad', legacyMode:
    'this_computer' }).remoteUrl, null);
});

test('远程地址只收 https 源地址，没写协议的补上', () => {
  assert.equal(normalizeRemoteUrl(' you.cyberhunter.top '), 'https://you.cyberhunter.top/');
  assert.equal(normalizeRemoteUrl('https://203.0.113.10:8443'), 'https://203.0.113.10:8443/');
  for (const bad of ['http://a.b', 'https://a.b/path', 'https://u:p@a.b', 'https://a.b/?x=1', '::']) {
    assert.throws(() => normalizeRemoteUrl(bad), RemoteUrlError, bad);
  }
});

test('窗口载入的地址：这台电脑是本机端口；远程没填过时先回本机', () => {
  assert.equal(targetUrl({ mode: 'this_computer', remoteUrl: 'https://a.b/' }, true), LOCAL_SERVER_URL);
  assert.equal(targetUrl({ mode: 'remote', remoteUrl: 'https://a.b/' }, true), 'https://a.b/');
  assert.equal(targetUrl({ mode: 'remote', remoteUrl: null }, true), LOCAL_SERVER_URL);
  assert.equal(targetUrl({ mode: 'remote', remoteUrl: null }, false), null);
  assert.ok(sameOrigin('https://a.b/#/notes', 'https://a.b/'));
  assert.ok(!sameOrigin('https://evil.a.b/', 'https://a.b/'));
  assert.ok(!sameOrigin('not a url', 'https://a.b/'));
});

test('设置整份存、整份读；坏文件挪走留着，不覆盖', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'settings.json');
  const fallback = () => defaultSettings({ mode: 'remote', remoteUrl: 'https://a.b/' }, '/home/a');
  assert.ok(SettingsStore.firstRun(file));
  const store = new SettingsStore(file, fallback, () => undefined);
  assert.ok(existsSync(file));
  store.update((settings) => ({ ...settings, notifications: false }));
  assert.equal(new SettingsStore(file, fallback, () => undefined).get().notifications, false);
  assert.throws(() => store.update((settings) => ({ ...settings, roots: [''] })), /形状不对/);
  writeFileSync(file, '{坏了');
  const logs: string[] = [];
  const reopened = new SettingsStore(file, fallback, (line) => logs.push(line));
  assert.equal(reopened.get().notifications, true);
  const kept = readdirSync(dir).find((name) => name.startsWith('settings.json.broken-'));
  assert.ok(kept !== undefined);
  assert.equal(readFileSync(join(dir, kept), 'utf8'), '{坏了');
  assert.equal(logs.length, 1);
});
