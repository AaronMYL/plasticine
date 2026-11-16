// 图片和音视频转格式、改图（11-16）：真跑这台机器上的 ffmpeg（没有就跳过并写明原因）。

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { convertMedia, editImage } from '../../src/cloud-tools/index.ts';
import { pixelSize } from '../../src/artifacts/office/package-xml.ts';

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;
const SKIP = { skip: HAS_FFMPEG ? false : '这台机器没有装 ffmpeg' };

/** 每行开头一个过滤字节 0，后面是灰色像素。 */
function rows(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x60);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 3 + 1)] = 0;
  }
  return raw;
}

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows(width, height))), chunk('IEND', Buffer.alloc(0))]);
}

test('PNG 转 JPEG、WebP；坏图说 ffmpeg 没转成；没有 ffmpeg 说清楚', SKIP, async () => {
  const signal = AbortSignal.timeout(60_000);
  const jpeg = await convertMedia('ffmpeg', { data: png(64, 32), extension: 'png' }, 'jpg', signal, 70);
  assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  const webp = await convertMedia('ffmpeg', { data: png(64, 32), extension: 'png' }, 'webp', signal);
  assert.deepEqual(pixelSize(webp), { width: 64, height: 32 });
  await assert.rejects(convertMedia('ffmpeg', { data: Buffer.from('坏图'), extension: 'png' }, 'jpg', signal),
    /ffmpeg 没转成/);
  await assert.rejects(convertMedia('/没有/ffmpeg', { data: png(2, 2), extension: 'png' }, 'jpg', signal),
    /没有 ffmpeg/);
});

test('改图：两张横拼到同高，裁剪、打码、加字（带 % 和引号）、缩放、旋转，尺寸照每一步算', SKIP, async () => {
  const signal = AbortSignal.timeout(60_000);
  const inputs = [{ data: png(64, 32), extension: 'png' }, { data: png(32, 32), extension: 'png' }];
  const out = await editImage('ffmpeg', inputs,
    [{ op: 'crop', x: 0, y: 0, width: 160, height: 100 }, { op: 'blur', x: 4, y: 4, width: 20, height: 20 },
      { op: 'text', text: '封面 100% \'引号\'', x: 4, y: 40, size: 20 }, { op: 'resize', width: 80 },
      { op: 'rotate', degrees: 90 }], 'png', signal, { joinSize: 100 });
  assert.deepEqual(pixelSize(out), { width: 50, height: 80 });
});
