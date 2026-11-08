// 旧节点迁移入口：同一包重试与保留已经放好的桥接包是两种明确结果，不把新日期版误当旧包。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Value } from 'typebox/value';
import { MacReleaseFileSchema } from '../agent/shared/api/index.ts';
import { publishMacUpdate, type PublishCommands, type PublishedRelease } from './publish-mac-update.ts';

const SHA = 'b'.repeat(64);
const COMMIT = 'c'.repeat(40);
const DIR = '/home/plasticine/state/agent/downloads/mac';
const BRIDGE = { schema: 1 as const, releaseVersion: '2026.1106.120000',
  releaseUrl: 'https://cyberhunter.top/download' };
const INPUT = { zip: '/runner/tmp/Plasticine-mac-2026.1106.120000.zip', version: '0.7.3', commit: COMMIT,
  stateDirectory: '/home/plasticine/state/agent', user: 'plasticine', now: () => new Date('2026-11-06T12:00:00Z') };

function release(version = '0.7.3', sha256 = SHA, commit = COMMIT): PublishedRelease {
  return { version, sha256, file: `Plasticine-${version}.zip`, commit, publishedAt: '2026-11-06T12:00:00.000Z' };
}

function fake(current: string | null, options: { landedSha?: string; currentSha?: string } = {}) {
  const calls: string[] = [];
  const written: string[] = [];
  const logs: string[] = [];
  let installed = false;
  const commands: PublishCommands = {
    sha256: async () => SHA,
    writeTemp: async (text) => { written.push(text); return '/tmp/latest.json'; },
    log: (line) => logs.push(line),
    run: async (command, args) => {
      calls.push([command, ...args].join(' '));
      if (args.includes('test')) {
        return { code: current !== null && args.at(-1)?.endsWith('/latest.json') ? 0 : 1, stdout: '' };
      }
      if (args.includes('cat')) return { code: 0, stdout: current ?? '' };
      if (args.includes('install') && args.includes(INPUT.zip)) installed = true;
      if (args.includes('sha256sum')) {
        const currentSum = current === null ? SHA : (JSON.parse(current) as { sha256: string }).sha256;
        return { code: 0, stdout: `${installed ? options.landedSha ?? SHA : options.currentSha ?? currentSum}  zip\n` };
      }
      return { code: 0, stdout: '' };
    },
  };
  return { commands, calls, written, logs };
}

test('第一次放迁移包：同一zip落盘核对后才原子写latest，扩展标记兼容原节点读取schema', async () => {
  const f = fake(null);
  const result = await publishMacUpdate({ ...INPUT, bridge: BRIDGE }, f.commands);
  assert.deepEqual(result, { status: 'published', release: { ...release(), bridge: BRIDGE } });
  assert.ok(Value.Check(MacReleaseFileSchema, JSON.parse(f.written[0] ?? 'null')));
  assert.deepEqual(f.calls.filter((call) => !call.includes(' test ')), [
    `sudo -n install -d -o plasticine -g plasticine -m 0750 ${DIR}`,
    `sudo -n install -o plasticine -g plasticine -m 0640 ${INPUT.zip} ${DIR}/.Plasticine-0.7.3.zip.part`,
    `sudo -n -u plasticine mv -f ${DIR}/.Plasticine-0.7.3.zip.part ${DIR}/Plasticine-0.7.3.zip`,
    `sudo -n -u plasticine sha256sum ${DIR}/Plasticine-0.7.3.zip`,
    `sudo -n install -o plasticine -g plasticine -m 0640 /tmp/latest.json ${DIR}/.latest.json.part`,
    `sudo -n -u plasticine mv -f ${DIR}/.latest.json.part ${DIR}/latest.json`,
  ]);
  assert.ok(f.calls.every((call) => call.startsWith('sudo -n ')));
  assert.ok(!f.calls.some((call) => /systemctl|sqlite|plasticine\.sqlite/.test(call)));
});

test('同版重试同时核对commit、SHA和现存文件，只有完全同一份才是unchanged', async () => {
  const exact = fake(JSON.stringify({ ...release(), bridge: BRIDGE }));
  assert.equal((await publishMacUpdate({ ...INPUT, bridge: BRIDGE }, exact.commands)).status, 'unchanged');
  assert.ok(exact.calls.some((call) => call.includes('sha256sum')));
  assert.equal(exact.written.length, 0);
  for (const current of [release('0.7.3', 'a'.repeat(64)), release('0.7.3', SHA, 'd'.repeat(40)),
    { version: '0.7.3', sha256: SHA, file: 'Plasticine-0.7.3.zip' }]) {
    const f = fake(JSON.stringify(current));
    await assert.rejects(publishMacUpdate(INPUT, f.commands), /同一版|来源|CFBundleShortVersionString/);
    assert.equal(f.written.length, 0);
    assert.ok(!f.calls.some((call) => call.includes(' install ')));
  }
});

test('0.7.2旧安装可以迁移到0.7.3；已发布bridge让后续同App版本明确保留原包', async () => {
  const old = fake(JSON.stringify(release('0.7.2', 'a'.repeat(64), 'd'.repeat(40))));
  const initial = await publishMacUpdate({ ...INPUT, bridge: BRIDGE }, old.commands);
  assert.equal(initial.status, 'published');
  const stored = { ...release('0.7.3', 'a'.repeat(64), 'd'.repeat(40)),
    bridge: { ...BRIDGE, releaseVersion: '2026.1105.120000' } };
  const next = fake(JSON.stringify(stored));
  const result = await publishMacUpdate({ ...INPUT, bridge: BRIDGE }, next.commands);
  assert.deepEqual(result, { status: 'retained', release: stored });
  assert.equal(next.written.length, 0);
  assert.ok(!next.calls.some((call) => call.includes(' install ')));
  assert.match(next.logs.join('\n'), /保留.*0\.7\.3/);
  assert.ok(stored.commit !== undefined);
  assert.ok(next.logs.join('\n').includes(stored.commit));
});

test('只保留明确成功的较早bridge；同commit不同zip、同日期版不同来源、无标记旧包、降App版本均拒绝', async () => {
  const current = { ...release('0.7.3', 'a'.repeat(64), 'd'.repeat(40)),
    bridge: { ...BRIDGE, releaseVersion: '2026.1105.120000' } };
  const attempts = [
    { stored: { ...current, commit: COMMIT }, input: { ...INPUT, bridge: BRIDGE } },
    { stored: { ...current, bridge: BRIDGE }, input: { ...INPUT, bridge: BRIDGE } },
    { stored: release('0.7.3', 'a'.repeat(64), 'd'.repeat(40)), input: { ...INPUT, bridge: BRIDGE } },
    { stored: current, input: { ...INPUT, version: '0.7.2', bridge: BRIDGE } },
    { stored: current, input: INPUT },
  ];
  for (const attempt of attempts) {
    const f = fake(JSON.stringify(attempt.stored));
    await assert.rejects(publishMacUpdate(attempt.input, f.commands));
    assert.equal(f.written.length, 0);
    assert.ok(!f.calls.some((call) => call.includes(' install ')));
  }
});

test('旧latest损坏或指向错误字节时失败，不按首次发布覆盖', async () => {
  for (const current of ['bad json', '{}', JSON.stringify({ ...release(), file: '../outside.zip' }),
    JSON.stringify({ ...release(), commit: 'main' }), JSON.stringify({ ...release(), publishedAt: 'yesterday' }),
    JSON.stringify({ ...release(), bridge: { ...BRIDGE, releaseVersion: '0.7.3' } })]) {
    const f = fake(current);
    await assert.rejects(publishMacUpdate({ ...INPUT, version: '0.7.4', bridge: BRIDGE }, f.commands), /latest.json/);
    assert.ok(!f.calls.some((call) => call.includes(' install ')));
  }
  const changed = fake(JSON.stringify(release('0.7.2')), { currentSha: 'a'.repeat(64) });
  await assert.rejects(publishMacUpdate({ ...INPUT, bridge: BRIDGE }, changed.commands), /现存.*校验/);
  assert.equal(changed.written.length, 0);
});

test('落盘校验失败不换latest；非法输入在任何发布写入前拒绝', async () => {
  const f = fake(null, { landedSha: 'd'.repeat(64) });
  await assert.rejects(publishMacUpdate({ ...INPUT, bridge: BRIDGE }, f.commands), /校验值对不上/);
  assert.equal(f.written.length, 0);
  await assert.rejects(publishMacUpdate({ ...INPUT, version: '0.7.3; rm -rf /' }, fake(null).commands), /版本号/);
  await assert.rejects(publishMacUpdate({ ...INPUT, commit: 'main' }, fake(null).commands), /40 位/);
  const different = fake(null);
  await assert.rejects(publishMacUpdate({ ...INPUT, expectedSha256: 'a'.repeat(64) }, different.commands), /catalog/);
  assert.equal(different.calls.length, 0);
});
