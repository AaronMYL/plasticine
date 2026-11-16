// 存文件、发文件这两件工具（artifacts/file-tools.ts）在这里接上对话附件的归属和公网下载。

import { fileTools, type Workspace } from '../artifacts/index.ts';
import { PublicFetchError, PublicFetcher } from '../cloud-tools/index.ts';
import type { KernelTool } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { ATTACHMENT_OWNER } from './attachments.ts';

/** 下一个文件最多等这么久：20 MB 在慢的线路上一分钟内下得完，再久多半是对方卡住了。 */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** 设备动作的回执里哪一项是整份图或文件（base64）。 */
const DEVICE_FILE_FIELDS: Readonly<Partial<Record<string, string>>> = { tab_shot: 'jpeg', screen_capture: 'png',
  photo_read: 'jpeg', file_fetch: 'base64' };

/** 一次设备动作交回的图或文件：要做成了的、有图或文件的那几种。 */
export function deviceFileOf(state: StateService, actionId: string): Buffer {
  const action = state.nodeActions.byActionId(actionId);
  const field = action === undefined ? undefined : DEVICE_FILE_FIELDS[action.kind];
  if (action === undefined || field === undefined) {
    throw new Error(`没有「${actionId}」这次截图或拿文件的记录：用 device_action 回的 actionId。`);
  }
  const data: unknown = action.status === 'executed' && typeof action.result === 'object' && action.result !== null
    ? Reflect.get(action.result, field) : undefined;
  if (typeof data !== 'string' || data === '') {
    throw new Error('那次动作没做成，或者回执里没有图：重新截一次再存。');
  }
  return Buffer.from(data, 'base64');
}

export function assembleFileTools(state: StateService, workspace: Workspace,
  fetcher: PublicFetcher = new PublicFetcher()): KernelTool[] {
  return fileTools({ workspace, state, attachmentOwner: ATTACHMENT_OWNER,
    deviceFile: (actionId) => deviceFileOf(state, actionId),
    async download(url, maxBytes, signal) {
      try {
        const got = await fetcher.get(url, { accept: '*/*', types: null, maxBytes, timeoutMs: DOWNLOAD_TIMEOUT_MS,
          userAgent: 'PlasticineFiles/1.0' }, signal);
        return { data: got.data, type: got.type };
      } catch (cause) {
        if (cause instanceof PublicFetchError) throw new Error(`没下下来：${cause.message}`, { cause });
        throw cause;
      }
    } });
}
