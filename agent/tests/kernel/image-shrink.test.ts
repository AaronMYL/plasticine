// 来信配图存之前压小（第13批，11-14 Aaron 弹框选「压小」）：订阅那一路出的图不压缩（实测 1672×941、约 2.4 MB），
// 存之前转成最宽 1200 的 webp；用已有的 ffmpeg（转写组件里的或系统里的），没有就存原图，不加新依赖。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ShrinkingIllustrator, shrinkIllustration } from '../../src/kernel/index.ts';

const hasFfmpeg = spawnSync('ffmpeg', ['-hide_banner', '-version']).status === 0;
const signal = new AbortController().signal;

/** 用 ffmpeg 画一张和订阅出的一样宽的图当原图（满是噪点的无损 webp，不压缩时很大）。 */
function bigWebp(): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'shrink-test-'));
  const file = join(dir, 'big.webp');
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    "nullsrc=s=1672x941,geq=lum='random(1)*255':cb=128:cr=128", '-frames:v', '1', '-c:v', 'libwebp',
    '-lossless', '1', file]);
  return readFileSync(file);
}

function widthOf(data: Buffer): number {
  const file = join(mkdtempSync(join(tmpdir(), 'shrink-probe-')), 'out.webp');
  writeFileSync(file, data);
  return Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width',
    '-of', 'csv=p=0', file]).toString().trim());
}

test('有 ffmpeg：转成最宽 1200 的 webp，比原图小', { skip: !hasFfmpeg }, async () => {
  const original = bigWebp();
  const shrunk = await shrinkIllustration(original, 'image/webp', 'ffmpeg', signal);
  assert.equal(shrunk.mime, 'image/webp');
  assert.ok(shrunk.data.length < original.length, `${shrunk.data.length} 应该小于 ${original.length}`);
  assert.equal(shrunk.data.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(shrunk.data.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.equal(widthOf(shrunk.data), 1200);
});

test('没有 ffmpeg、转不成：存原图', async () => {
  const original = Buffer.from('not really an image');
  assert.deepEqual(await shrinkIllustration(original, 'image/webp', 'plasticine-no-such-ffmpeg', signal),
    { data: original, mime: 'image/webp' });
  if (hasFfmpeg) {
    assert.deepEqual(await shrinkIllustration(original, 'image/png', 'ffmpeg', signal),
      { data: original, mime: 'image/png' });
  }
});

test('包一层：画出来的先压小；画不出来的原样回原因', async () => {
  const seen: string[] = [];
  const inner = { draw: async (prompt: string) => prompt === '画不出'
    ? { error: '出图超时了' } : { data: Buffer.from('raw'), mime: 'image/webp' as const } };
  const wrapped = new ShrinkingIllustrator(inner, () => 'ffmpeg-path', async (data, mime, ffmpeg) => {
    seen.push(ffmpeg);
    return { data: Buffer.concat([data, Buffer.from('-small')]), mime };
  });
  const drawn = await wrapped.draw('纸船', signal);
  assert.ok('data' in drawn && drawn.data.toString() === 'raw-small');
  assert.deepEqual(seen, ['ffmpeg-path']);
  assert.deepEqual(await wrapped.draw('画不出', signal), { error: '出图超时了' });
});
