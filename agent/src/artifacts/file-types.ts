// 文件页收哪些类型（审查 P1：外部输入——上传的文件——先校验）：按扩展名认，图片、PDF 和 Office / ZIP 再核开头的几个字节，
// 文字类的不许有 NUL。可执行文件、脚本、网页这类不收。下载时按扩展名给 Content-Type，认不出的一律当二进制附件。

import { ArtifactError } from './errors.ts';

export interface FileType {
  type: string;
  /** The first bytes a file of this type starts with; text types have none and must not contain NUL. */
  magic?: readonly number[];
  text?: boolean;
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];

export const FILE_TYPES: Readonly<Record<string, FileType>> = {
  txt: { type: 'text/plain; charset=utf-8', text: true },
  md: { type: 'text/markdown; charset=utf-8', text: true },
  csv: { type: 'text/csv; charset=utf-8', text: true },
  json: { type: 'application/json', text: true },
  log: { type: 'text/plain; charset=utf-8', text: true },
  yaml: { type: 'text/yaml; charset=utf-8', text: true },
  yml: { type: 'text/yaml; charset=utf-8', text: true },
  png: { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  jpeg: { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  gif: { type: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  webp: { type: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
  pdf: { type: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  docx: { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: ZIP },
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: ZIP },
  pptx: { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: ZIP },
  zip: { type: 'application/zip', magic: ZIP },
};

/** Pictures the file page and artifact cards may show inline; everything else downloads as an attachment. */
export const INLINE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The Content-Type to answer with; unknown types are plain bytes. */
export function contentTypeOf(name: string): string {
  return FILE_TYPES[extensionOf(name)]?.type ?? 'application/octet-stream';
}

/** Checks an upload's name against the allowed types and its first bytes against its type. */
export function checkUpload(name: string, data: Buffer): FileType {
  const extension = extensionOf(name);
  const fileType = FILE_TYPES[extension];
  if (fileType === undefined) {
    const allowed = Object.keys(FILE_TYPES).join('、');
    throw new ArtifactError('unsupported_type', `不收 .${extension || '（没有扩展名）'} 的文件；能收：${allowed}。`, 'name');
  }
  if (fileType.magic !== undefined && !fileType.magic.every((byte, index) => data[index] === byte)) {
    throw new ArtifactError('unsupported_type', `文件内容和 .${extension} 对不上，没有存。`, 'content');
  }
  if (fileType.text === true && data.includes(0)) {
    throw new ArtifactError('unsupported_type', `.${extension} 应该是文字，这个文件里有 NUL，没有存。`, 'content');
  }
  return fileType;
}
