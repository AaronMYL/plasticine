import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import type { WebContents } from 'electron';
import { LocalServer } from '../src/app/local-server.ts';
import { ServerPlace } from '../src/app/server-place.ts';
import { prefillRemote } from '../src/app/server-target.ts';
import { defaultSettings, serverChosen, SettingsStore } from '../src/app/settings-store.ts';
import { tempDir } from './helpers.ts';

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  kill(signal: string): boolean {
    setImmediate(() => this.emit('exit', null, signal));
    return true;
  }
}

class FakeView {
  url = '';
  loads: string[] = [];
  getURL(): string {
    return this.url;
  }
  async loadURL(url: string): Promise<void> {
    this.url = url;
    this.loads.push(url);
  }
  on(): void {}
  setWindowOpenHandler(): void {}
}

interface Rig {
  place: ServerPlace;
  view: FakeView;
  settings: SettingsStore;
  local: LocalServer;
  launches: string[];
  probes: string[];
  probeFails: { value: string | null };
}

function rig(t: { after(fn: () => void): void }, options: { bundled?: boolean; settings?: unknown;
  enterLocal?: string } = {}): Rig {
  const dir = tempDir(t);
  const file = join(dir, 'settings.json');
  if (options.settings !== undefined) {
    writeFileSync(file, JSON.stringify(options.settings));
  }
  const settings = new SettingsStore(file, () => defaultSettings(prefillRemote(null), '/home/a'), () => undefined);
  const launches: string[] = [];
  const local = new LocalServer({
    launch: (token) => {
      launches.push(token);
      return new FakeChild() as unknown as ChildProcess;
    },
    healthy: async () => true, now: Date.now, log: () => undefined,
  }, options.bundled ?? true);
  const view = new FakeView();
  const probes: string[] = [];
  const probeFails: { value: string | null } = { value: null };
  const place = new ServerPlace({ ui: view as unknown as WebContents, settings, local,
    startPage: '/app/dist/start.html', override: null, log: () => undefined, openExternal: () => undefined,
    enterLocal: async () => options.enterLocal ?? '',
    probe: async (url) => {
      probes.push(url);
      if (probeFails.value !== null) {
        throw new Error(probeFails.value);
      }
    } });
  t.after(() => void local.stop());
  return { place, view, settings, local, launches, probes, probeFails };
}

function query(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

test('第一次打开：显示二选一，不起本机本体、不替他选', async (t) => {
  const { place, view, launches, settings } = rig(t);
  await place.load();
  assert.equal(view.loads.length, 1);
  assert.equal(query(view.url).get('state'), 'welcome');
  assert.equal(query(view.url).get('current'), null);
  assert.equal(query(view.url).get('bundled'), '1');
  assert.equal(launches.length, 0);
  assert.equal(place.target(), null);
  assert.equal(serverChosen(settings.get()), false);
});

test('选了远程却没有地址：回开始页，不悄悄回落本机', async (t) => {
  const { place, view, launches } = rig(t, { settings: { schema: 1, server: { mode: 'remote', remoteUrl: null },
    serverChosen: true, notifications: true, devicePaused: false, roots: ['/home/a'] } });
  await place.load();
  assert.equal(query(view.url).get('state'), 'welcome');
  assert.equal(launches.length, 0);
});

test('在这台电脑上：存选择、开始页显示正在打开，起来后按账号状态进建账号页', async (t) => {
  const { place, view, launches, settings } = rig(t, { enterLocal: '#/setup' });
  await place.load();
  await place.choose({ mode: 'this_computer', remoteUrl: null });
  assert.equal(serverChosen(settings.get()), true);
  assert.equal(launches.length, 1);
  assert.equal(query(view.loads[1] ?? '').get('state'), 'starting');
  assert.equal(view.url, 'http://127.0.0.1:8790/#/setup');
  assert.ok(place.onSite());
});

test('连到我的 Plasticine：先探地址，到不了就地报原因、不存；到得了存下并载入登录页、停本机本体', async (t) => {
  const { place, view, settings, probes, probeFails, local } = rig(t);
  await place.choose({ mode: 'this_computer', remoteUrl: null });
  assert.equal(local.state, 'running');
  probeFails.value = '连不上 nowhere.example，检查一下地址和网络。';
  await assert.rejects(place.choose({ mode: 'remote', remoteUrl: 'nowhere.example' }), /连不上 nowhere\.example/);
  assert.equal(settings.get().server.mode, 'this_computer');
  probeFails.value = null;
  await place.choose({ mode: 'remote', remoteUrl: '@sample_user' });
  assert.deepEqual(probes, ['https://nowhere.example/', 'https://sample-user.cyberhunter.top/']);
  assert.deepEqual(settings.get().server, { mode: 'remote', remoteUrl: 'https://sample-user.cyberhunter.top/' });
  assert.equal(view.url, 'https://sample-user.cyberhunter.top/#/login');
  assert.equal(local.state, 'stopped');
});

test('换地方：回开始页并标出现在用的那一个，不停本机本体；包里没带本体时这台电脑选不了', async (t) => {
  const { place, view, local } = rig(t);
  await place.choose({ mode: 'this_computer', remoteUrl: null });
  await place.welcome();
  assert.equal(query(view.url).get('state'), 'welcome');
  assert.equal(query(view.url).get('current'), 'this_computer');
  assert.equal(local.state, 'running');
  const bare = rig(t, { bundled: false });
  await assert.rejects(bare.place.choose({ mode: 'this_computer', remoteUrl: null }), /没有带/);
  await bare.place.load();
  assert.equal(query(bare.view.url).get('bundled'), '0');
});
