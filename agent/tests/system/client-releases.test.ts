// 客户端发布记录（system/client-releases.ts）：界面每分钟查一次新版本，这条路不能每次都重读清单、重查整张表。
// 部署清单和发布回执没变就不重登记；换了一版马上认出来；登记只按构建标识读那一行。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { ClientManifest } from '../../shared/api/index.ts';
import { ClientReleases, recordClientRelease } from '../../src/system/index.ts';
import { openTestState, tempDirectory, throwsState, type TestState } from '../state/helpers.ts';

let t: TestState;
let site: { directory: string; cleanup(): Promise<void> };

beforeEach(async () => {
  t = await openTestState();
  site = await tempDirectory();
});

afterEach(async () => {
  await t.cleanup();
  await site.cleanup();
});

/** 在发布目录里放一版：一个资源文件加清单；回清单。at 是清单文件的改动时间（同一秒里连发两版也分得开）。 */
async function deploy(buildId: string, at: Date): Promise<ClientManifest> {
  const body = `console.log(${JSON.stringify(buildId)})`;
  await mkdir(join(site.directory, 'assets'), { recursive: true });
  await writeFile(join(site.directory, 'assets', 'main.js'), body);
  const manifest: ClientManifest = { buildId, builtAt: at.toISOString(), protocol: { min: 2, max: 2 },
    summary: `${buildId} 的说明`, assets: [{ path: 'assets/main.js', bytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex') }] };
  const path = join(site.directory, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest));
  await utimes(path, at, at);
  return manifest;
}

function releases(): { releases: ClientReleases; registered: () => number } {
  let count = 0;
  const register = t.state.clientUpdates.register.bind(t.state.clientUpdates);
  t.state.clientUpdates.register = (manifest) => {
    count += 1;
    register(manifest);
  };
  return { releases: new ClientReleases({ state: t.state, manifestPath: join(site.directory, 'manifest.json'),
    receiptPath: join(site.directory, 'receipt.json') }), registered: () => count };
}

test('清单和回执没变：再查多少次都不重读、不重登记，回的还是这一版', async () => {
  await deploy('build-1', new Date('2026-11-17T01:00:00.000Z'));
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  const { releases: client, registered } = releases();
  for (let round = 0; round < 50; round += 1) {
    client.scan();
  }
  assert.equal(registered(), 1);
  assert.deepEqual(client.version(), { current: { buildId: 'build-1', builtAt: '2026-11-17T01:00:00.000Z',
    protocol: { min: 2, max: 2 }, summary: 'build-1 的说明' }, error: null });
});

test('只有清单、还没有发布回执：不算现在这一版；回执写好以后马上认出来', async () => {
  await deploy('build-1', new Date('2026-11-17T01:00:00.000Z'));
  const { releases: client } = releases();
  client.scan();
  assert.deepEqual(client.version(), { current: null, error: null });
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  client.scan();
  assert.equal(client.version().current?.buildId, 'build-1');
});

test('换了一版：下一次查就是新的这一版，两版都登记着', async () => {
  await deploy('build-1', new Date('2026-11-17T01:00:00.000Z'));
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  const { releases: client, registered } = releases();
  client.scan();
  await deploy('build-2', new Date('2026-11-17T02:00:00.000Z'));
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  client.scan();
  client.scan();
  assert.equal(client.version().current?.buildId, 'build-2');
  assert.equal(registered(), 2);
  assert.equal(t.state.clientUpdates.require('build-1').status, 'published');
  assert.equal(t.state.clientUpdates.require('build-2').status, 'published');
});

test('清单坏了：回一句出错，不当成没有版本', async () => {
  await writeFile(join(site.directory, 'manifest.json'), '{"buildId":');
  const { releases: client } = releases();
  client.scan();
  assert.deepEqual(client.version(), { current: null, error: '客户端发布记录校验失败，请检查部署清单。' });
});

test('登记只按构建标识找那一行：库里版本再多也一样；同一个标识换了内容不收', async () => {
  const first = await deploy('build-1', new Date('2026-11-17T01:00:00.000Z'));
  for (let index = 0; index < 30; index += 1) {
    t.state.clientUpdates.register({ ...first, buildId: `older-${index}` });
  }
  t.state.clientUpdates.register(first);
  t.state.clientUpdates.register(first);
  assert.equal(t.state.clientUpdates.list().length, 31);
  assert.equal(t.state.clientUpdates.require('older-7').manifest.buildId, 'older-7');
  throwsState(() => t.state.clientUpdates.register({ ...first, summary: '换了内容' }), 'invalid_input');
  throwsState(() => t.state.clientUpdates.require('没有这一版'), 'not_found');
});
