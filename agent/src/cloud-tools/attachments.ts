import { CloudToolError } from './errors.ts';
import { officeText } from './office-text.ts';
import type { AttachmentTransport } from './transports.ts';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
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
const OFFICE_READ: Readonly<Record<string, { kind: 'xlsx' | 'pptx'; type: string }>> = {
  xlsx: { kind: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { kind: 'pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
};
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
  const office = OFFICE_READ[extension];
  if (office !== undefined) {
    const text = officeText(office.kind, file.data);
    if (text === null) {
      throw new CloudToolError('invalid_input', `这份 .${extension} 读不出来（不是正常的文件，或者加了密）。`, 'file');
    }
    return { ...clip(text), type: office.type };
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
