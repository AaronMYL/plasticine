import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { WebContents } from 'electron';
import { TabActionError, type StepReporter } from '../node/action-runner.ts';
import type { DeviceActionParams } from '../../../agent/shared/api/index.ts';
import { uploadThroughChooser } from './cdp.ts';
import { chooserInFrame, setMarkedFilesAnywhere } from './frame-upload.ts';
import type { FrameRoute, TabFrames } from './tab-frames.ts';

const CHOOSER_WAIT_MS = 5_000;
const UPLOAD_KEEP_MS = 30 * 60_000;

export async function placeFiles(contents: WebContents, mark: Record<string, unknown>, nonce: string,
  files: readonly { name: string; base64: string }[], step: StepReporter, route: FrameRoute)
  : Promise<'input' | 'chooser'> {
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
    if (await setMarkedFilesAnywhere(contents, nonce, paths)) return 'input';
  } else if (typeof mark.center === 'object' && mark.center !== null) {
    step('点上传按钮，接住「选择文件」');
    const center = mark.center as { x: number; y: number };
    const chosen = route.frame === null
      ? await uploadThroughChooser(contents, center.x, center.y, paths, CHOOSER_WAIT_MS)
      : await chooserInFrame(contents, route.frame.url, center, paths, CHOOSER_WAIT_MS);
    if (chosen) return 'chooser';
  }
  throw new TabActionError(null, '这个编号不是上传框，点了也没弹出「选择文件」：换成上传按钮或文件框的编号。');
}

export async function uploadTo(contents: WebContents, frames: TabFrames, tabId: string,
  action: Extract<DeviceActionParams, { kind: 'tab_upload' }>, step: StepReporter): Promise<'input' | 'chooser'> {
  const route = frames.route(tabId, action.version, action.n);
  const nonce = randomUUID();
  const mark = route === null ? null : await frames.call(tabId, route, 'operate', { request: { op: 'mark',
    version: route.version, n: route.n, nonce } }) as Record<string, unknown> | null;
  if (route === null || mark === null || typeof mark !== 'object' || mark.found !== true) {
    throw new TabActionError('page_stale', '页面变了，编号过期了，先重新感知。');
  }
  if (mark.file === true && mark.multiple !== true && action.files.length > 1) {
    throw new TabActionError(null, '这个上传框一次只收一个文件：分几次传。');
  }
  return placeFiles(contents, mark, nonce, action.files, step, route);
}
