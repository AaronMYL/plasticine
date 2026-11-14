import { Worker } from 'node:worker_threads';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  CONVERSATION_ATTACHMENT_MAX_BYTES,
  CONVERSATION_ATTACHMENT_TEXT_LIMIT,
  type AttachmentMime,
} from '../../shared/attachments.ts';
import { CloudToolError } from './errors.ts';
import { OFFICE_TYPES, officeText } from './office-text.ts';

/** PDF、Office 文件超过这么大就不读正文（附件照样发，模型只知道名字和类型）。 */
const PARSE_MAX_BYTES = 30 * 1024 * 1024;
/** 文字类最多看这么多字节（够 9 000 字）。 */
const TEXT_SCAN_BYTES = 64 * 1024;
const KNOWN_IMAGES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const failure = () => new CloudToolError('invalid_input', '附件无法读取。请核对类型、文件完整性或是否为扫描版 PDF。');
const PdfResult = Type.Object({ ok: Type.Literal(true), text: Type.String(), truncated: Type.Boolean() });

function pdfText(data: Buffer, signal: AbortSignal): Promise<{ text: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    // PDF.js 的诊断不接到应用日志，避免解析器错误带出文档内容。
    const worker = new Worker(new URL('./pdf-worker.ts', import.meta.url), {
      workerData: new Uint8Array(data),
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    let finished = false;
    const end = (result: { text: string; truncated: boolean } | null): void => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (result === null) {
        reject(failure());
      } else {
        resolve(result);
      }
    };
    const abort = () => end(null);
    const timer = setTimeout(abort, 15_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: unknown) => end(Value.Check(PdfResult, message) ? message : null));
    worker.once('error', abort);
    worker.once('exit', () => {
      if (!finished) {
        end(null);
      }
    });
    if (signal.aborted) {
      abort();
    }
  });
}

export function imageMatches(type: AttachmentMime, data: Buffer): boolean {
  if (type === 'image/png') {
    return (
      data.length >= 24 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      data.toString('ascii', 12, 16) === 'IHDR' &&
      data.readUInt32BE(16) > 0 &&
      data.readUInt32BE(20) > 0
    );
  }
  if (type === 'image/jpeg') {
    return (
      data.length > 4 &&
      data[0] === 255 &&
      data[1] === 216 &&
      data[2] === 255 &&
      data.at(-2) === 255 &&
      data.at(-1) === 217
    );
  }
  return (
    type === 'image/webp' &&
    data.length >= 16 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP' &&
    data.readUInt32LE(4) + 8 === data.length
  );
}

/** 读正文要原件开头多少字节：图要整份核对，PDF、Office 不太大才读整份，文字类看开头一截，别的不读（0）。 */
export function extractionBytes(type: string, bytes: number): number {
  if (KNOWN_IMAGES.has(type)) return bytes;
  if (type === 'application/pdf' || OFFICE_TYPES[type] !== undefined) return bytes <= PARSE_MAX_BYTES ? bytes : 0;
  if (type.startsWith('text/') || type === 'application/json') return Math.min(bytes, TEXT_SCAN_BYTES + 1);
  return 0;
}

function clipped(text: string): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  return chars.length <= CONVERSATION_ATTACHMENT_TEXT_LIMIT ? { text, truncated: false }
    : { text: chars.slice(0, CONVERSATION_ATTACHMENT_TEXT_LIMIT).join(''), truncated: true };
}

/**
 * 读一份对话附件的正文（第13批起任意类型）：三种图核对字节、不读字；PDF、Word、Excel、PowerPoint 读出文字；文字类
 * 按 UTF-8 读；别的类型、太大的、读不出字的都是 text null（附件照样能发，模型只知道名字、类型和大小）。只有认得的图
 * 字节对不上、取消了才抛错。
 */
export async function extractConversationAttachment(
  type: AttachmentMime,
  data: Buffer,
  signal: AbortSignal,
): Promise<{ text: string | null; truncated: boolean }> {
  if (signal.aborted || data.length === 0 || data.length > CONVERSATION_ATTACHMENT_MAX_BYTES) {
    throw failure();
  }
  const none = { text: null, truncated: false };
  if (KNOWN_IMAGES.has(type)) {
    if (!imageMatches(type, data)) {
      throw failure();
    }
    return none;
  }
  if (type === 'application/pdf') {
    if (data.length > PARSE_MAX_BYTES || data.toString('ascii', 0, 5) !== '%PDF-') return none;
    try {
      return await pdfText(data, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      return none;
    }
  }
  const office = OFFICE_TYPES[type];
  if (office !== undefined) {
    const text = data.length > PARSE_MAX_BYTES ? null : officeText(office, data);
    return text === null || text.trim() === '' ? none : clipped(text);
  }
  if (!type.startsWith('text/') && type !== 'application/json') return none;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, TEXT_SCAN_BYTES),
      { stream: data.length > TEXT_SCAN_BYTES });
  } catch {
    return none;
  }
  if (text.includes('\0')) return none;
  const result = clipped(text);
  return { text: result.text, truncated: result.truncated || data.length > TEXT_SCAN_BYTES };
}
