// What books/ refuses. The message is shown to the user as is, so it is one Chinese sentence plus the next step;
// the technical reason, when there is one, travels in `cause` for the logs.

export const BOOK_ERROR_CODES = ['drm', 'unsupported', 'corrupt', 'empty', 'too_large'] as const;
export type BookErrorCode = (typeof BOOK_ERROR_CODES)[number];

export const BOOK_MESSAGES = {
  drm: '这本书带 DRM 加密，打不开。请用没有加密的版本再导入。',
  unsupportedFormat: '认不出这个文件的格式。请导入 EPUB、TXT、MOBI 或 AZW3 文件。',
  unsupportedHuff: '这本 MOBI 用了 HUFF/CDIC 压缩，暂时读不了。请先用 Calibre 转成 EPUB 再导入。',
  unsupportedCompression: '这个文件用了不认识的压缩方式，读不了。请先用 Calibre 转成 EPUB 再导入。',
  corrupt: '文件已损坏或不完整，读不出内容。请重新下载或换一个版本再导入。',
  empty: '这本书里没有读得出的文字。请确认文件内容，或换一个版本再导入。',
  tooLarge: '文件超过 100 MB，太大了。请压缩图片或拆分后再导入。',
  unpackedTooLarge: '这本书解压后太大，超过了上限。请换一个较小的版本再导入。',
} as const;

export class BookParseError extends Error {
  readonly code: BookErrorCode;

  constructor(code: BookErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BookParseError';
    this.code = code;
  }
}

export function corrupt(cause?: unknown): BookParseError {
  return new BookParseError('corrupt', BOOK_MESSAGES.corrupt, { cause });
}
