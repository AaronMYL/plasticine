// 本地转写组件（第13批）：按系统挑要下的几样；下、核对、解开、试转一段静音都好了才算装好；下坏了不装、说清原因，
// 再点安装从没下完的那份接着来；环境变量配的照旧优先；sherpa 的输出读成带时间的句子。

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import type { TranscriberStatus } from '../../shared/api/video.ts';
import { PublicFetchError } from '../../src/cloud-tools/index.ts';
import {
  kitBytes,
  kitFailure,
  kitPlan,
  sherpaFailure,
  sherpaLines,
  silentWav,
  TranscribeKit,
  wavHeaderSeconds,
  type KitPlan,
  type KitPorts,
  type Transcriber,
} from '../../src/video/index.ts';

let temp: string;
beforeEach(() => { temp = mkdtempSync(join(tmpdir(), 'kit-')); });
afterEach(() => { rmSync(temp, { recursive: true, force: true }); });

const digest = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

const RUNTIME = Buffer.from('假的转写程序压缩包');
const MODEL = Buffer.from('假的模型压缩包');
const VAD = Buffer.from('假的 VAD');
const FFMPEG = gzipSync(Buffer.from('#!/bin/sh\necho ffmpeg\n'));
const CONTENT: Readonly<Record<string, Buffer>> = { 'runtime.tar.bz2': RUNTIME, 'model.tar.bz2': MODEL,
  'silero_vad.onnx': VAD, 'ffmpeg.gz': FFMPEG };

const PLAN: KitPlan = {
  files: [
    { name: 'runtime.tar.bz2', url: 'https://example.test/runtime.tar.bz2', bytes: RUNTIME.length,
      sha256: digest(RUNTIME), into: 'sherpa', unpack: { kind: 'tar.bz2', members: ['rt/bin/asr', 'rt/lib'] } },
    { name: 'model.tar.bz2', url: 'https://example.test/model.tar.bz2', bytes: MODEL.length, sha256: digest(MODEL),
      into: 'model', unpack: { kind: 'tar.bz2', members: ['sv/model.int8.onnx', 'sv/tokens.txt'] } },
    { name: 'silero_vad.onnx', url: 'https://example.test/silero_vad.onnx', bytes: VAD.length, sha256: digest(VAD),
      into: 'model', unpack: { kind: 'file', target: 'model/silero_vad.onnx' } },
    { name: 'ffmpeg.gz', url: 'https://example.test/ffmpeg.gz', bytes: FFMPEG.length, sha256: digest(FFMPEG),
      into: 'ffmpeg', unpack: { kind: 'gz', target: 'ffmpeg/ffmpeg' } },
  ],
  binary: 'sherpa/rt/bin/asr',
  model: 'model/sv/model.int8.onnx',
  tokens: 'model/sv/tokens.txt',
  vad: 'model/silero_vad.onnx',
  ffmpeg: 'ffmpeg/ffmpeg',
};

interface Harness {
  kit: TranscribeKit;
  statuses: TranscriberStatus[];
  downloads: string[];
  checks: string[];
}

function harness(options: { env?: Transcriber | null; plan?: KitPlan | null; ports?: Partial<KitPorts> } = {}):
  Harness {
  const statuses: TranscriberStatus[] = [];
  const downloads: string[] = [];
  const checks: string[] = [];
  const ports: Partial<KitPorts> = {
    async download(url, file, _signal, bytes) {
      downloads.push(url);
      const name = url.split('/').at(-1) ?? '';
      const data = CONTENT[name] ?? Buffer.alloc(0);
      await writeFile(file, data);
      bytes(data.length);
    },
    async untar(archive, into, members) {
      for (const member of members) {
        const path = member.endsWith('/lib') ? join(into, member, 'libonnxruntime.so') : join(into, member);
        await mkdir(join(path, '..'), { recursive: true });
        await writeFile(path, `解自 ${archive.split('/').at(-1) ?? ''}`);
      }
    },
    async check(transcriber, ffmpeg) {
      checks.push(`${transcriber.name} ${ffmpeg.endsWith(join('ffmpeg', 'ffmpeg')) ? 'ffmpeg' : ffmpeg}`);
    },
    ...options.ports,
  };
  const kit = new TranscribeKit({ directory: join(temp, 'components'),
    plan: options.plan === undefined ? PLAN : options.plan, env: options.env ?? null, ports,
    changed: (status) => statuses.push(status), threads: 2 });
  return { kit, statuses, downloads, checks };
}

test('按系统挑要下的几样：五种系统各有一份，别的系统没有；大小按发布页加起来', () => {
  for (const [platform, arch] of [['linux', 'x64'], ['linux', 'arm64'], ['darwin', 'arm64'], ['darwin', 'x64'],
    ['win32', 'x64']] as const) {
    const plan = kitPlan(platform, arch);
    assert.ok(plan !== null, `${platform}-${arch}`);
    assert.equal(plan.files.length, 4);
    assert.ok(plan.files.every((file) => /^https:\/\/github\.com\/(k2-fsa\/sherpa-onnx|eugeneware\/ffmpeg-static)\//
      .test(file.url) && /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.ok(kitBytes(plan) > 200_000_000 && kitBytes(plan) < 250_000_000);
  }
  assert.match(kitPlan('win32', 'x64')!.binary, /\.exe$/);
  assert.equal(kitPlan('freebsd', 'x64'), null);
  assert.equal(kitPlan('linux', 'ia32'), null);
});

test('装：下、核对、解开、试转都好了才算装好；装好以后用组件里的转写和 ffmpeg，下载的包清掉', async () => {
  const h = harness();
  assert.equal(h.kit.status().state, 'absent');
  assert.equal(h.kit.status().totalBytes, kitBytes(PLAN));
  assert.equal(h.kit.transcriber(), null);
  assert.equal(h.kit.ffmpeg(), 'ffmpeg');
  assert.equal(h.kit.install().state, 'installing');
  assert.equal(h.kit.install().state, 'installing', '装着再点不重来');
  await h.kit.settled();
  const done = h.kit.status();
  assert.deepEqual([done.state, done.source, done.doneBytes], ['ready', 'kit', kitBytes(PLAN)]);
  assert.equal(h.statuses.at(-1)?.state, 'ready');
  assert.ok(h.statuses.some((status) => status.state === 'installing' && status.step === 'unpack'));
  assert.equal(h.downloads.length, 4);
  assert.deepEqual(h.checks, ['sensevoice:kit ffmpeg']);
  const root = join(temp, 'components', 'transcribe');
  assert.equal(h.kit.ffmpeg(), join(root, 'ffmpeg', 'ffmpeg'));
  assert.equal((await readFile(join(root, 'ffmpeg', 'ffmpeg'), 'utf8')).trim(), '#!/bin/sh\necho ffmpeg');
  assert.ok(existsSync(join(root, 'model', 'silero_vad.onnx')));
  assert.ok(!existsSync(join(temp, 'components', 'downloads')));
  assert.ok(!existsSync(join(temp, 'components', 'transcribe.partial')));
  assert.equal(h.kit.transcriber()?.name, 'sensevoice:kit');
  // 重启以后读 kit.json 认出装好了。
  assert.equal(harness().kit.status().state, 'ready');
});

test('下坏了不装、写原因；再点安装只重下坏的那一份', async () => {
  let broken = true;
  const h = harness({ ports: {
    async download(url, file, _signal, bytes) {
      h.downloads.push(url);
      const name = url.split('/').at(-1) ?? '';
      const data = name === 'model.tar.bz2' && broken ? Buffer.from('坏的') : CONTENT[name]!;
      await writeFile(file, data);
      bytes(data.length);
    },
  } });
  h.kit.install();
  await h.kit.settled();
  const failed = h.kit.status();
  assert.equal(failed.state, 'failed');
  assert.match(failed.error ?? '', /「model\.tar\.bz2」和发布页上的对不上/);
  assert.equal(h.kit.transcriber(), null);
  broken = false;
  h.downloads.length = 0;
  h.kit.install();
  await h.kit.settled();
  assert.equal(h.kit.status().state, 'ready');
  assert.deepEqual(h.downloads, ['https://example.test/model.tar.bz2', 'https://example.test/silero_vad.onnx',
    'https://example.test/ffmpeg.gz'], '下好核对过的那份不再下');
});

test('试转一段没成：不算装好，写清楚原因', async () => {
  const h = harness({ ports: { async check() { throw new Error('本地转写没起来：spawn EACCES'); } } });
  h.kit.install();
  await h.kit.settled();
  assert.equal(h.kit.status().state, 'failed');
  assert.match(h.kit.status().error ?? '', /^装好了但试转一段没成：本地转写没起来/);
  assert.ok(!existsSync(join(temp, 'components', 'transcribe')));
});

test('环境变量配的转写优先，不用装；没有现成组件的系统写「用不上」', () => {
  const env: Transcriber = { name: 'sensevoice:env', transcribe: async () => ({ lines: [], audioSeconds: null,
    peakMb: null, engine: 'env' }) };
  const configured = harness({ env });
  assert.deepEqual([configured.kit.status().state, configured.kit.status().source], ['ready', 'env']);
  assert.equal(configured.kit.transcriber(), env);
  assert.equal(configured.kit.install().state, 'ready');
  const other = harness({ plan: null });
  assert.equal(other.kit.status().state, 'unsupported');
  assert.equal(other.kit.install().state, 'unsupported');
});

test('没装成的原因写成人话', () => {
  assert.match(kitFailure(new PublicFetchError('failed', '远程服务器连不上或连接中断，请稍后再试。')), /连不上 GitHub/);
  assert.match(kitFailure(new PublicFetchError('timeout', '远程服务器读取超时，请稍后再试。')), /超时/);
  assert.match(kitFailure(Object.assign(new Error('no space'), { code: 'ENOSPC' })), /磁盘空间不够/);
  assert.match(kitFailure(Object.assign(new Error('spawn tar ENOENT'), { code: 'ENOENT', path: 'tar' })), /没有 tar/);
});

test('sherpa 的输出读成带时间的句子；出错取最有用的一行', () => {
  const out = ['0.742 -- 5.136: 开饭时间早上9点至下午5点。', '7.686 -- 10.032: The tribal chieftain called for the boy.',
    '12.000 -- 12.500: ', 'Started!', ''].join('\n');
  assert.deepEqual(sherpaLines(out), [{ start: 0.742, text: '开饭时间早上9点至下午5点。' },
    { start: 7.686, text: 'The tribal chieftain called for the boy.' }]);
  const err = ['/home/runner/work/sherpa-onnx/sherpa-onnx/sherpa-onnx/csrc/silero-vad-model-config.cc:Validate:59 '
    + "Silero vad model file 'x.onnx' does not exist", 'Errors in vad_config!'].join('\n');
  assert.equal(sherpaFailure(err), "Silero vad model file 'x.onnx' does not exist");
});

test('wav 的秒数从文件头读：自己写的静音、ffmpeg 多写一个 LIST 块的都认得', () => {
  assert.equal(wavHeaderSeconds(silentWav(2.5)), 2.5);
  const plain = silentWav(1);
  const list = Buffer.alloc(8 + 26);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(26, 4);
  const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)]);
  assert.equal(wavHeaderSeconds(withList), 1);
  assert.equal(wavHeaderSeconds(Buffer.from('不是 wav')), null);
});
