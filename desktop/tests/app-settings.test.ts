import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { desktopPaths } from '../src/app/desktop-paths.ts';
import { LOCAL_SERVER_URL, normalizeRemoteUrl, prefillRemote, RemoteUrlError, sameOrigin,
  targetUrl } from '../src/app/server-target.ts';
import { defaultSettings, serverChosen, SettingsStore } from '../src/app/settings-store.ts';
import { tempDir } from './helpers.ts';

test('Mac reuses Swift agent data directory while isolating Electron web data', () => {
  const paths = desktopPaths('darwin', { home: '/Users/you' });
  assert.equal(paths.serverState, '/Users/you/Library/Application Support/Plasticine/server');
  assert.equal(paths.userData, '/Users/you/Library/Application Support/Plasticine/Desktop');
  assert.equal(paths.legacyCredentials, '/Users/you/Library/Application Support/Plasticine/node-credential');
  assert.equal(paths.logs, '/Users/you/Library/Logs/Plasticine');
});

test('Windows reuses tray agent %LOCALAPPDATA%\\Plasticine\\state directory', () => {
  const paths = desktopPaths('win32', { home: 'C:\\Users\\a', localAppData: 'C:\\Users\\a\\AppData\\Local' });
  assert.equal(paths.serverState, 'C:\\Users\\a\\AppData\\Local\\Plasticine\\state');
  assert.equal(paths.logs, 'C:\\Users\\a\\AppData\\Local\\Plasticine\\logs');
});

test('first launch has no default host choice and uses legacy Swift remote URL only as prefill', (t) => {
  const file = join(tempDir(t), 'settings.json');
  const store = new SettingsStore(file, () => defaultSettings(prefillRemote('https://203.0.113.7/'), '/home/a'),
    () => undefined);
  assert.equal(serverChosen(store.get()), false);
  assert.equal(store.get().server.remoteUrl, 'https://203.0.113.7/');
  assert.equal(prefillRemote(null).remoteUrl, null);
  assert.equal(prefillRemote('http://bad').remoteUrl, null);
  writeFileSync(file, JSON.stringify({ schema: 1, server: { mode: 'this_computer', remoteUrl: null },
    notifications: true, devicePaused: false, roots: ['/home/a'] }));
  assert.equal(serverChosen(new SettingsStore(file, () => defaultSettings(prefillRemote(null), '/home/a'),
    () => undefined).get()), false);
});

test('remote address accepts only https origins and prepends https when scheme omitted', () => {
  assert.equal(normalizeRemoteUrl(' you.cyberhunter.top '), 'https://you.cyberhunter.top/');
  assert.equal(normalizeRemoteUrl('https://203.0.113.10:8443'), 'https://203.0.113.10:8443/');
  for (const bad of ['http://a.b', 'https://a.b/path', 'https://u:p@a.b', 'https://a.b/?x=1', '::']) {
    assert.throws(() => normalizeRemoteUrl(bad), RemoteUrlError, bad);
  }
});

test('window loads local port locally and null (start page) when remote URL unset, no silent fallback', () => {
  assert.equal(targetUrl({ mode: 'this_computer', remoteUrl: 'https://a.b/' }, true), LOCAL_SERVER_URL);
  assert.equal(targetUrl({ mode: 'remote', remoteUrl: 'https://a.b/' }, true), 'https://a.b/');
  assert.equal(targetUrl({ mode: 'remote', remoteUrl: null }, true), null);
  assert.equal(targetUrl({ mode: 'remote', remoteUrl: null }, false), null);
  assert.equal(targetUrl({ mode: 'this_computer', remoteUrl: 'https://a.b/' }, false), null);
  assert.ok(sameOrigin('https://a.b/#/notes', 'https://a.b/'));
  assert.ok(!sameOrigin('https://evil.a.b/', 'https://a.b/'));
  assert.ok(!sameOrigin('not a url', 'https://a.b/'));
});

test('saves and loads settings atomically and moves corrupt file aside without overwriting', (t) => {
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

test('test override directory isolates client config, creds, receipts, updates, logs, and local agent', () => {
  const paths = desktopPaths('darwin', { home: '/Users/demo', userData: '/tmp/plasticine-test-only' });
  for (const path of Object.values(paths)) assert.ok(path.startsWith('/tmp/plasticine-test-only'));
  assert.notEqual(paths.credentials, paths.legacyCredentials);
});
