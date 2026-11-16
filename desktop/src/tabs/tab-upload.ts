// tab_upload 的后半段（11-16）：服务端带来的文件先写到临时文件夹（网页读的是磁盘上的文件），是文件框就直接放进去；
// 是「上传」按钮就接管「选择文件」、可信地点它、接住弹出来的那一次（不弹给他）。临时文件过半小时删掉：网页可能
// 过一会儿才真的读它（选完文件再点「上传」）。

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { WebContents } from 'electron';
import { TabActionError, type StepReporter } from '../node/action-runner.ts';
import { setMarkedFiles, uploadThroughChooser } from './cdp.ts';

/** 点了上传按钮后等「选择文件」弹出最多这么久。 */
const CHOOSER_WAIT_MS = 5_000;
const UPLOAD_KEEP_MS = 30 * 60_000;

export async function placeFiles(contents: WebContents, mark: Record<string, unknown>, nonce: string,
  files: readonly { name: string; base64: string }[], step: StepReporter): Promise<'input' | 'chooser'> {
  step('把文件写到临时文件夹');
  const folder = await mkdtemp(join(tmpdir(), 'plasticine-upload-'));
  setTimeout(() => void rm(folder, { recursive: true, force: true }), UPLOAD_KEEP_MS).unref();
  const paths: string[] = [];
  for (const file of files) {
    const path = join(folder, basename(file.name));
    await writeFile(path, Buffer.from(file.base64, 'base64'), { mode: 0o600 });
    paths.push(path);
  }
  if (mark.file === true) {
    step('放进文件框');
    if (await setMarkedFiles(contents, nonce, paths)) return 'input';
  } else if (typeof mark.center === 'object' && mark.center !== null) {
    step('点上传按钮，接住「选择文件」');
    const center = mark.center as { x: number; y: number };
    if (await uploadThroughChooser(contents, center.x, center.y, paths, CHOOSER_WAIT_MS)) return 'chooser';
  }
  throw new TabActionError(null, '这个编号不是上传框，点了也没弹出「选择文件」：换成上传按钮或文件框的编号。');
}
