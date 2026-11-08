import { Worker } from 'node:worker_threads';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  CONVERSATION_ATTACHMENT_MAX_BYTES,
  CONVERSATION_ATTACHMENT_TEXT_LIMIT,
  type AttachmentMime,
} from '../../shared/attachments.ts';
import { CloudToolError } from './errors.ts';

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

function imageMatches(type: AttachmentMime, data: Buffer): boolean {
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

export async function extractConversationAttachment(
  type: AttachmentMime,
  data: Buffer,
  signal: AbortSignal,
): Promise<{ text: string | null; truncated: boolean }> {
  if (signal.aborted || data.length === 0 || data.length > CONVERSATION_ATTACHMENT_MAX_BYTES) {
    throw failure();
  }
  if (type.startsWith('image/')) {
    if (!imageMatches(type, data)) {
      throw failure();
    }
    return { text: null, truncated: false };
  }
  if (type === 'application/pdf') {
    if (data.toString('ascii', 0, 5) !== '%PDF-') {
      throw failure();
    }
    return pdfText(data, signal);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw failure();
  }
  if (text.includes('\0')) {
    throw failure();
  }
  return {
    text: text.slice(0, CONVERSATION_ATTACHMENT_TEXT_LIMIT),
    truncated: text.length > CONVERSATION_ATTACHMENT_TEXT_LIMIT,
  };
}
