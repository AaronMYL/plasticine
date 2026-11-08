// 附件转文字（1ca0391 attachment-text.ts）：纯文字类的直接按 UTF-8 读；PDF、Word 这类经注入的传输转（M5 没接，回「还没
// 接上」）。先看类型和大小：只收认得的几种，超过上限的不读；文字里的 NUL 当作不是文字。

import { CloudToolError } from './errors.ts';
import type { AttachmentTransport } from './transports.ts';

// 一个附件最多 10 MB（够一份长 PDF；旧版的附件 408 个里最大的是截图）。
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
// 给模型的字最多这么多（工具结果一页 10 000 字）。
export const ATTACHMENT_TEXT_MAX_CHARS = 9_000;
export const TEXT_TYPES: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
};
export const CONVERTED_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
// %PDF- and the ZIP header a .docx starts with.
const MAGIC: Readonly<Record<string, readonly number[]>> = { pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], docx: [0x50, 0x4b] };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function startsWith(data: Buffer, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

function clip(text: string): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= ATTACHMENT_TEXT_MAX_CHARS) {
    return { text, truncated: false };
  }
  return { text: chars.slice(0, ATTACHMENT_TEXT_MAX_CHARS).join(''), truncated: true };
}

export async function attachmentText(
  transport: AttachmentTransport,
  file: { name: string; data: Buffer },
  signal: AbortSignal,
): Promise<{ text: string; truncated: boolean; type: string }> {
  if (file.data.length > ATTACHMENT_MAX_BYTES) {
    throw new CloudToolError('invalid_input', `附件超过 ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB，没有读。`, 'file');
  }
  const extension = extensionOf(file.name);
  const textType = TEXT_TYPES[extension];
  if (textType !== undefined) {
    const text = file.data.toString('utf8');
    if (text.includes('\0')) {
      throw new CloudToolError('invalid_input', '这个文件看起来不是文字（里面有 NUL）。', 'file');
    }
    return { ...clip(text), type: textType };
  }
  const convertedType = CONVERTED_TYPES[extension];
  const magic = MAGIC[extension];
  if (convertedType === undefined || magic === undefined) {
    throw new CloudToolError('invalid_input', `不认识 .${extension || '（没有扩展名）'} 这种附件。`, 'file');
  }
  if (!startsWith(file.data, magic)) {
    throw new CloudToolError('invalid_input', `文件内容和 .${extension} 对不上，没有读。`, 'file');
  }
  return { ...clip(await transport.toText(file.data, convertedType, signal)), type: convertedType };
}
