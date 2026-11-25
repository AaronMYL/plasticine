import { fileTools, mediaTools, officeTools, sandboxTool, type FileTranscriptLike, type MediaToolParts,
  type Workspace } from '../artifacts/index.ts';
import { attachmentText, type AttachmentTransport, convertMedia, editImage, officeText, printPdf, PublicFetchError,
  PublicFetcher, Sandbox, xlsxSheets } from '../cloud-tools/index.ts';
import type { Illustrator } from '../kernel/index.ts';
import type { KernelTool } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { ATTACHMENT_OWNER } from './attachments.ts';

const DOWNLOAD_TIMEOUT_MS = 60_000;

const DEVICE_FILE_FIELDS: Readonly<Partial<Record<string, string>>> = { tab_shot: 'jpeg', screen_capture: 'png',
  file_fetch: 'base64' };

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
  attachments: AttachmentTransport;
  illustrator: Illustrator | null;
  video: {
    ffmpeg(): string;
    transcribeFile(input: Parameters<MediaToolParts['transcribe']>[0], signal: AbortSignal):
      Promise<FileTranscriptLike>;
  };
  sandboxRoot: string;
  printPdf?: ((html: string, signal: AbortSignal) => Promise<Buffer>) | undefined;
  now: () => Date;
}

function outsideTools(workspace: Workspace, outside: FileToolOutside): KernelTool[] {
  const ffmpeg = (): string => outside.video.ffmpeg();
  const sandbox = new Sandbox({ root: outside.sandboxRoot });
  const media = (input: { data: Buffer; extension: string }, output: string, signal: AbortSignal, quality?: number) =>
    convertMedia(ffmpeg(), input, output, signal, quality);
  return [
    ...officeTools({ workspace, printPdf: outside.printPdf ?? ((html, signal) => printPdf(html, signal)), officeText,
      xlsxSheets, convertMedia: media,
      pdfText: async (name, data, signal) =>
        (await attachmentText(outside.attachments, { name, data }, signal)).text }),
    ...mediaTools({ workspace,
      editImage: (inputs, ops, output, signal, options) => editImage(ffmpeg(), inputs, ops, output, signal,
        options),
      draw: async (prompt, signal) => (outside.illustrator === null
        ? { error: '这台 Plasticine 没有能出图的模型（设置 · AI 里接一个 OpenAI 的账号）。' }
        : outside.illustrator.draw(prompt, signal)),
      transcribe: (input, signal) => outside.video.transcribeFile(input, signal) }),
    sandboxTool({ workspace, available: () => sandbox.available(), now: outside.now,
      run: (request, signal) => sandbox.run(request, signal) }),
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
