// 转写前先拉平音量（11-18）：量音量、太轻才拉平、转出来多少。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { coverageOf, coverageText, tooQuiet, transcriptStarts, wavLoudness } from '../../src/video/leveling.ts';
import { extractAudio } from '../../src/video/media.ts';
import { defaultLeveling } from '../../src/video/pipeline.ts';
import { silentWav } from '../../src/video/wav.ts';

/** n 秒 440Hz 正弦（16kHz 单声道 16 位），振幅 0–1。 */
function toneWav(seconds: number, amplitude: number): Buffer {
  const wav = silentWav(seconds);
  for (let index = 0; index < seconds * 16_000; index += 1) {
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / 16_000) * amplitude * 32_767), 44 + index * 2);
  }
  return wav;
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('量音量：一秒一秒算，响的、一半的各多响；太轻才拉平', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'leveling-'));
  try {
    const loud = join(dir, 'loud.wav');
    const quiet = join(dir, 'quiet.wav');
    writeFileSync(loud, toneWav(4, 0.5));
    writeFileSync(quiet, toneWav(4, 0.01));
    const a = await wavLoudness(loud);
    const b = await wavLoudness(quiet);
    assert.ok(a !== null && b !== null);
    assert.ok(Math.abs(a.loudDb - -9) < 1, `0.5 振幅的正弦约 -9 dBFS：${String(a.loudDb)}`);
    assert.equal(tooQuiet(a), false);
    assert.equal(tooQuiet(b), true);
    writeFileSync(quiet, silentWav(0));
    assert.equal(await wavLoudness(quiet), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('默认那一档：抖音不拉平，别的网站、直链先量再定', () => {
  assert.equal(defaultLeveling({ platform: 'douyin' }), 'off');
  assert.equal(defaultLeveling({ platform: 'web' }), 'auto');
});

test('转出来多少：几句、第一句在哪、最长一段没字（开头、中间、结尾都算），读回逐字稿的时间', () => {
  const starts = transcriptStarts('[05:01] 第一句\n[05:05] 二\n[99:30] 最后\n没时间的一行');
  assert.deepEqual(starts, [301, 305, 5970]);
  const coverage = coverageOf(starts, 5_990);
  assert.deepEqual(coverage, { lines: 3, firstAt: 301, longestGap: { from: 305, seconds: 5665 } });
  const text = coverageText(coverage, false);
  assert.match(text, /转出 3 句；第一句在 05:01；最长一段没字 1:34:25（从 05:05 起）；这次没拉平音量/);
  assert.match(coverageText(coverageOf([], 60), true), /转出 0 句；最长一段没字 01:00（从 00:00 起）；这次先拉平了音量/);
});

test('抽声音：on 拉平、off 不拉、auto 太轻才拉平，拉平以后真的响了', { skip: hasFfmpeg ? false : '这台机器上没有 ffmpeg' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'leveling-ffmpeg-'));
  const signal = AbortSignal.timeout(60_000);
  try {
    const quiet = join(dir, 'quiet.wav');
    const loud = join(dir, 'loud.wav');
    writeFileSync(quiet, toneWav(6, 0.01));
    writeFileSync(loud, toneWav(6, 0.5));
    const out = join(dir, 'out.wav');
    assert.deepEqual(await extractAudio(quiet, out, signal, 'ffmpeg', 'off'), { seconds: 6, leveled: false });
    const before = await wavLoudness(out);
    assert.deepEqual(await extractAudio(quiet, out, signal, 'ffmpeg', 'auto'), { seconds: 6, leveled: true });
    const after = await wavLoudness(out);
    assert.ok(before !== null && after !== null && after.loudDb > before.loudDb + 10, '拉平以后响了');
    assert.equal((await extractAudio(loud, out, signal, 'ffmpeg', 'auto')).leveled, false, '够响的不动');
    assert.equal((await extractAudio(loud, out, signal, 'ffmpeg', 'on')).leveled, true, '指定 on 照样拉平');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
