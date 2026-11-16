// 文件页的工具在这里接上外面的东西：存文件、发文件（artifacts/file-tools.ts）接对话附件的归属和公网下载；
// 生成、转格式（office-tools.ts）接云端浏览器打印 PDF、读 Office 和 PDF 的字、ffmpeg；出图、改图、转写
// （media-tools.ts）接出图的模型、ffmpeg、本地转写。

import { fileTools, mediaTools, officeTools, sandboxTool, type Workspace } from '../artifacts/index.ts';
import { attachmentText, type AttachmentTransport, convertMedia, editImage, officeText, printPdf, PublicFetchError,
  PublicFetcher, type Sandbox, xlsxSheets } from '../cloud-tools/index.ts';
import type { Illustrator } from '../kernel/index.ts';
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

export interface FileToolOutside {
  /** 读 PDF 的字（云端的附件转换）。 */
  attachments: AttachmentTransport;
  illustrator: Illustrator | null;
  /** 要跑的 ffmpeg（装了本地转写用组件里的）。 */
  ffmpeg: () => string;
  transcribe(input: { data: Buffer; extension: string }, signal: AbortSignal):
    Promise<{ text: string; seconds: number | null; engine: string }>;
  /** 测试换成假的：不起浏览器。 */
  printPdf?: (html: string, signal: AbortSignal) => Promise<Buffer>;
  sandbox: Sandbox;
  now: () => Date;
}

function outsideTools(workspace: Workspace, outside: FileToolOutside): KernelTool[] {
  const media = (input: { data: Buffer; extension: string }, output: string, signal: AbortSignal, quality?: number) =>
    convertMedia(outside.ffmpeg(), input, output, signal, quality);
  return [
    ...officeTools({ workspace, printPdf: outside.printPdf ?? ((html, signal) => printPdf(html, signal)), officeText,
      xlsxSheets, convertMedia: media,
      pdfText: async (name, data, signal) =>
        (await attachmentText(outside.attachments, { name, data }, signal)).text }),
    ...mediaTools({ workspace,
      editImage: (inputs, ops, output, signal, options) => editImage(outside.ffmpeg(), inputs, ops, output, signal,
        options),
      draw: async (prompt, signal) => (outside.illustrator === null
        ? { error: '这台 Plasticine 没有能出图的模型（设置 · AI 里接一个 OpenAI 的账号）。' }
        : outside.illustrator.draw(prompt, signal)),
      transcribe: (input, signal) => outside.transcribe(input, signal) }),
    sandboxTool({ workspace, available: () => outside.sandbox.available(), now: outside.now,
      run: (request, signal) => outside.sandbox.run(request, signal) }),
  ];
}

export function assembleFileTools(state: StateService, workspace: Workspace, outside: FileToolOutside,
  fetcher: PublicFetcher = new PublicFetcher()): KernelTool[] {
  return [...outsideTools(workspace, outside), ...fileTools({ workspace, state, attachmentOwner: ATTACHMENT_OWNER,
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
    } })];
}
