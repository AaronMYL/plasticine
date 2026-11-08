// Bytes to text for book files. A byte-order mark wins; markup may declare its encoding; Chinese files without
// either are usually GBK, which GB18030 (a superset) decodes.

const UTF8_BOM = [0xef, 0xbb, 0xbf];
// Encoding declarations sit in the first line of a document; looking further only risks matching body text.
const DECLARATION_SCAN_BYTES = 1024;
const XML_DECLARATION = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._:-]+)/i;

function startsWith(bytes: Buffer, prefix: number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function decodeUtf16be(bytes: Buffer): string {
  // Swapped into a copy: the input buffer belongs to the caller, and swap16 needs an even length.
  const even = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)));
  return even.swap16().toString('utf16le');
}

/** Decodes by byte-order mark; null when there is none. */
export function decodeWithBom(bytes: Buffer): string | null {
  if (startsWith(bytes, UTF8_BOM)) {
    return bytes.subarray(3).toString('utf8');
  }
  if (startsWith(bytes, [0xff, 0xfe])) {
    return bytes.subarray(2).toString('utf16le');
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return decodeUtf16be(bytes.subarray(2));
  }
  return null;
}

/** Decodes with a WHATWG encoding label; an unknown label falls back to UTF-8 rather than failing the book. */
export function decodeWithLabel(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch (error) {
    // RangeError is the TextDecoder constructor rejecting the label; decoding itself never throws when not fatal.
    if (!(error instanceof RangeError)) {
      throw error;
    }
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function decodeUtf8Strict(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    // TypeError is how a fatal TextDecoder reports invalid bytes; that answer is "not UTF-8".
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
}

/** XML / XHTML / HTML documents: BOM, then the declared encoding, then UTF-8. */
export function decodeMarkup(bytes: Buffer): string {
  const fromBom = decodeWithBom(bytes);
  if (fromBom !== null) {
    return fromBom;
  }
  const head = bytes.subarray(0, DECLARATION_SCAN_BYTES).toString('latin1');
  const label = XML_DECLARATION.exec(head)?.[1] ?? META_CHARSET.exec(head)?.[1];
  if (label !== undefined && !/^utf-?8$/i.test(label)) {
    return decodeWithLabel(bytes, label);
  }
  return bytes.toString('utf8');
}
