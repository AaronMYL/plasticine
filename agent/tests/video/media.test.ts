import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadTo, fetchImage, fetchText } from '../../src/video/media.ts';

test('视频媒体、图片和字幕下载拒绝本机内网与带账号的网址', async () => {
  const signal = new AbortController().signal;
  for (const url of ['http://127.0.0.1:9/test', 'http://169.254.169.254/test', 'http://printer.local/file',
    'https://name:secret@example.com/image']) {
    await assert.rejects(fetchImage(url, signal), /本机|内网|账号/);
    await assert.rejects(fetchText(url, signal), /本机|内网|账号/);
    await assert.rejects(downloadTo(url, '/unwritten-video-test.mp4', signal), /本机|内网|账号/);
  }
});
