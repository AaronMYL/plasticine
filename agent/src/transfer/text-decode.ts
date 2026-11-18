// 导入的文字文件读成字：认 BOM（UTF-8、UTF-16），没有 BOM 的先按 UTF-8，对不上再按 GB18030（Windows 记事本存的中文
// 常是 GBK）；都对不上、或者里面有零字节（多半是图片、压缩包）就当不是文字文件。换行统一成 \n。

function decode(data: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch (error) {
    // 字节对不上这个编码（TypeError），或者这个 Node 没带这种编码（RangeError）。
    if (error instanceof TypeError || error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

function withBom(data: Buffer): string | null | undefined {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return decode(data.subarray(3), 'utf-8');
  }
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
    return decode(data.subarray(2), 'utf-16le');
  }
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) {
    return decode(data.subarray(2), 'utf-16be');
  }
  return undefined;
}

/** 文件的字；不是文字文件是 null。 */
export function decodeText(data: Buffer): string | null {
  const marked = withBom(data);
  const text = marked === undefined ? decode(data, 'utf-8') ?? decode(data, 'gb18030') : marked;
  if (text === null || text.includes('\u0000')) {
    return null;
  }
  return text.replace(/\r\n?/g, '\n');
}
