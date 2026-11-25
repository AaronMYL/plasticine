import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import { convertMedia, editImage } from '../../src/cloud-tools/index.ts';
import { pixelSize } from '../../src/artifacts/office/package-xml.ts';

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version']).status === 0;
const SKIP = { skip: HAS_FFMPEG ? false : 'ffmpeg is not installed on this machine' };

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

test('converts PNG to JPEG/WebP; reports ffmpeg failure on corrupt image or missing ffmpeg', SKIP, async () => {
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

test(
  'edits images: hstack to match height, crop, blur, text (% & quotes), resize, rotate with sizes',
  SKIP, async () => {
  const signal = AbortSignal.timeout(60_000);
  const inputs = [{ data: png(64, 32), extension: 'png' }, { data: png(32, 32), extension: 'png' }];
  const out = await editImage('ffmpeg', inputs,
    [{ op: 'crop', x: 0, y: 0, width: 160, height: 100 }, { op: 'blur', x: 4, y: 4, width: 20, height: 20 },
      { op: 'text', text: '封面 100% \'引号\'', x: 4, y: 40, size: 20 }, { op: 'resize', width: 80 },
      { op: 'rotate', degrees: 90 }], 'png', signal, { joinSize: 100 });
  assert.deepEqual(pixelSize(out), { width: 50, height: 80 });
});
