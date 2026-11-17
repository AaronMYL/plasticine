// 客户端发布记录（system/client-releases.ts）：界面每分钟查一次新版本，这条路不能每次都重读清单、重查整张表。
// 部署清单和发布回执没变就不重读、不重记；换了一版马上认出来；同一份回执只算一次「换版了」。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import type { ClientManifest } from '../../shared/api/index.ts';
import { ClientReleases, recordClientRelease } from '../../src/system/index.ts';
import { openTestState, tempDirectory, type TestState } from '../state/helpers.ts';

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

function releases(): { releases: ClientReleases; recorded: () => number; changed: () => number } {
  let recorded = 0;
  let changed = 0;
  const publish = t.state.clientPublications.publish.bind(t.state.clientPublications);
  t.state.clientPublications.publish = (receipt) => {
    recorded += 1;
    return publish(receipt);
  };
  const client = new ClientReleases({ state: t.state, manifestPath: join(site.directory, 'manifest.json'),
    receiptPath: join(site.directory, 'receipt.json'), changed: () => { changed += 1; } });
  return { releases: client, recorded: () => recorded, changed: () => changed };
}

test('清单和回执没变：再查多少次都不重读、不重记，回的还是这一版', async () => {
  await deploy('build-1', new Date('2026-11-17T01:00:00.000Z'));
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  const { releases: client, recorded, changed } = releases();
  for (let round = 0; round < 50; round += 1) {
    client.scan();
  }
  assert.equal(recorded(), 1);
  assert.equal(changed(), 1);
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

test('换了一版：下一次查就是新的这一版，各算一次换版', async () => {
  await deploy('build-1', new Date('2026-11-17T01:00:00.000Z'));
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  const { releases: client, recorded, changed } = releases();
  client.scan();
  await deploy('build-2', new Date('2026-11-17T02:00:00.000Z'));
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  client.scan();
  client.scan();
  assert.equal(client.version().current?.buildId, 'build-2');
  assert.equal(recorded(), 2);
  assert.equal(changed(), 2);
});

test('服务重启后同一份回执不再算换版', async () => {
  await deploy('build-1', new Date('2026-11-17T01:00:00.000Z'));
  recordClientRelease(join(site.directory, 'manifest.json'), join(site.directory, 'receipt.json'), 'publish');
  releases().releases.scan();
  const again = releases();
  again.releases.scan();
  assert.equal(again.releases.version().current?.buildId, 'build-1');
  assert.equal(again.changed(), 0);
});

test('清单坏了：回一句出错，不当成没有版本', async () => {
  await writeFile(join(site.directory, 'manifest.json'), '{"buildId":');
  const { releases: client } = releases();
  client.scan();
  assert.deepEqual(client.version(), { current: null, error: '客户端发布记录校验失败，请检查部署清单。' });
});
