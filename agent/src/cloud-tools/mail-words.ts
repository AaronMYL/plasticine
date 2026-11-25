import { TextDecoder } from 'node:util';

const ENCODED_WORD = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;

interface Word {
  charset: string;
  bytes: Buffer;
}

function qBytes(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const hex = text.slice(i + 1, i + 3);
    if (char === '=' && /^[0-9a-fA-F]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else if (char === '_') {
      bytes.push(0x20);
    } else {
      bytes.push(text.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function charsetLabel(raw: string): string {
  return (raw.split('*')[0] ?? raw).trim().toLowerCase();
}

export function decodeCharset(bytes: Uint8Array, charset: string): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charsetLabel(charset) || 'utf-8');
  } catch (error) {
    if (error instanceof RangeError) {
      decoder = new TextDecoder('utf-8');
    } else {
      throw error;
    }
  }
  return decoder.decode(bytes);
}

function decodeRun(run: readonly Word[]): string {
  const first = run[0];
  if (first === undefined) {
    return '';
  }
  const joined = decodeCharset(Buffer.concat(run.map((word) => word.bytes)), first.charset);
  if (!joined.includes('�') || run.length === 1) {
    return joined;
  }
  return run.map((word) => decodeCharset(word.bytes, word.charset)).join('');
}

export function decodeHeaderWords(value: string): string {
  const parts: string[] = [];
  let run: Word[] = [];
  let last = 0;
  for (const match of value.matchAll(ENCODED_WORD)) {
    const between = value.slice(last, match.index);
    const charset = charsetLabel(match[1] ?? '');
    const text = match[3] ?? '';
    const bytes = (match[2] ?? '').toLowerCase() === 'b' ? Buffer.from(text, 'base64') : qBytes(text);
    const previous = run.at(-1);
    const folded = previous !== undefined && /^\s*$/.test(between);
    if (!folded || previous.charset !== charset) {
      parts.push(decodeRun(run), folded ? '' : between);
      run = [];
    }
    run.push({ charset, bytes });
    last = match.index + match[0].length;
  }
  parts.push(decodeRun(run), value.slice(last));
  return parts.join('');
}
