function decode(data: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch (error) {
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

export function decodeText(data: Buffer): string | null {
  const marked = withBom(data);
  const text = marked === undefined ? decode(data, 'utf-8') ?? decode(data, 'gb18030') : marked;
  if (text === null || text.includes('\u0000')) {
    return null;
  }
  return text.replace(/\r\n?/g, '\n');
}
