import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  CloudBrowser,
  CloudSsh,
  CloudToolError,
  CredentialFiles,
  readSshHosts,
  SSH_HOSTS_FILE,
  unconnectedTransports,
  type BrowserAction,
  type BrowserTransport,
  type SshTarget,
} from '../../src/cloud-tools/index.ts';
import { tempDirectory } from '../state/helpers.ts';

let dir: Awaited<ReturnType<typeof tempDirectory>>;

beforeEach(async () => {
  dir = await tempDirectory();
});

afterEach(async () => {
  await dir.cleanup();
});

function writeHosts(value: unknown): void {
  mkdirSync(join(dir.directory, 'cloud-tools'), { recursive: true });
  writeFileSync(join(dir.directory, SSH_HOSTS_FILE), JSON.stringify(value));
}

function credential(name: string): void {
  mkdirSync(join(dir.directory, 'credentials'), { recursive: true });
  writeFileSync(join(dir.directory, 'credentials', name), 'placeholder', { mode: 0o600 });
}

const signal = new AbortController().signal;

test('名单：没有文件就是空的；主机名不合格式、内网地址、格式不对的整份不用', () => {
  assert.deepEqual(readSshHosts(dir.directory), []);
  writeHosts({ hosts: [{ name: 'tencent', host: 'example.com', user: 'plasticine', credential: 'ssh-tencent' }] });
  assert.deepEqual(readSshHosts(dir.directory).map((host) => [host.name, host.port]), [['tencent', 22]]);
  writeHosts({ hosts: [{ name: 'evil', host: 'root@example.com', user: 'root', credential: 'k' }] });
  assert.throws(() => readSshHosts(dir.directory), CloudToolError);
  writeHosts({ hosts: [{ name: 'lan', host: '192.168.1.5', user: 'root', credential: 'k' }] });
  assert.throws(() => readSshHosts(dir.directory), /内网/);
  writeHosts({ hosts: [{ name: 'x', host: 'example.com', user: 'root', credential: 'k', password: 'nope' }] });
  assert.throws(() => readSshHosts(dir.directory), /格式不对/);
});

test('云端命令只连名单上的、凭据放好了的；命令经注入的传输跑，输出截短', async () => {
  writeHosts({ hosts: [{ name: 'tencent', host: 'example.com', user: 'plasticine', credential: 'ssh-tencent' }] });
  const seen: { target: SshTarget; command: string }[] = [];
  const ssh = new CloudSsh({
    stateDirectory: dir.directory,
    credentials: new CredentialFiles(join(dir.directory, 'credentials'), false),
    transport: {
      run: async (target, command) => {
        seen.push({ target, command });
        return { exitCode: 0, stdout: 'x'.repeat(5_000), stderr: '' };
      },
    },
  });
  await assert.rejects(ssh.run('tencent', 'uptime', signal), (error: unknown) => {
    return error instanceof CloudToolError && error.code === 'not_configured';
  });
  credential('ssh-tencent');
  await assert.rejects(ssh.run('other', 'uptime', signal), /不在可连的主机名单上/);
  await assert.rejects(ssh.run('tencent', 'a\0b', signal), CloudToolError);
  const result = await ssh.run('tencent', 'uptime', signal);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.target.host, 'example.com');
  assert.match(result.stdout, /截掉了 1000 字/);
  assert.deepEqual(ssh.hosts(), [{ name: 'tencent', host: 'example.com', ready: true }]);
});

test('默认的传输什么都不连：一律说还没接上', async () => {
  const transports = unconnectedTransports();
  await assert.rejects(transports.browser.open('https://example.com/', signal), /还没接上/);
  const outgoing = { to: 'a@b.cc', subject: 's', text: 't', inReplyTo: null };
  await assert.rejects(transports.mail.send({ credential: 'smtp' }, outgoing, signal), /还没接上/);
});

function fakeBrowser(landing: string): { transport: BrowserTransport; actions: BrowserAction[] } {
  const actions: BrowserAction[] = [];
  const page = (url: string) => ({ sessionId: 's1', url, title: '示例' });
  return {
    actions,
    transport: {
      open: async () => page(landing),
      act: async (_session, action) => {
        actions.push(action);
        return page(landing);
      },
      frame: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      text: async () => '页面上的字'.repeat(2_000),
    },
  };
}

test('云端浏览器：没开页面时不能操作；开了以后记下的网址去掉查询串；页面上的字截短', async () => {
  const fake = fakeBrowser('https://example.com/a?token=secret');
  const browser = new CloudBrowser({ transport: fake.transport, now: () => new Date('2026-10-27T01:00:00Z') });
  assert.equal(browser.view().open, false);
  await assert.rejects(browser.act({ kind: 'back' }, signal), /还没有打开页面/);
  const view = await browser.open('https://example.com/a?token=secret', signal);
  assert.equal(view.url, 'https://example.com/a');
  assert.equal(JSON.stringify(view).includes('secret'), false);
  const after = await browser.act({ kind: 'click', x: 10, y: 20 }, signal);
  assert.equal(after.lastAction, '点了 (10, 20)');
  await assert.rejects(browser.act({ kind: 'click', x: -1, y: 0 }, signal), CloudToolError);
  await assert.rejects(browser.act({ kind: 'key', key: 'NotAKey' }, signal), /不认识的按键/);
  assert.equal(fake.actions.length, 1);
  assert.ok((await browser.text(signal)).length <= 8_001);
});

test('云端浏览器：HTTP 页面按单浏览器约定保留地址', async () => {
  const fake = fakeBrowser('https://169.254.169.254/latest/meta-data');
  const browser = new CloudBrowser({ transport: fake.transport, now: () => new Date() });
  await browser.open('http://example.com/', signal);
  assert.equal(browser.view().open, true);
});
