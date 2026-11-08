// 邮件头的 RFC 2047 编码词（=?字符集?B|Q?…?=）。相邻、同字符集的编码词先把字节接起来再按字符集解：发件端常把一个汉字
// 拆在两个编码词里，各解各的会出 �。postal-mime 的 decodeWords 遇到带「=」补位的 B 段就不再接（线上见过），所以标题、
// 名字、收件人这几处用这里的解法。字符集认不出时按 UTF-8 读；接起来仍有 � 就退回各解各的。

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

/** RFC 2231 允许「utf-8*zh」带语言；字符集名不分大小写。 */
function charsetLabel(raw: string): string {
  return (raw.split('*')[0] ?? raw).trim().toLowerCase();
}

/** 按字符集解字节；字符集 Node 不认识时按 UTF-8 读，ASCII 部分照样看得见。 */
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
  // 接起来反而坏了（两段本来就是各自完整的）：各解各的。
  return run.map((word) => decodeCharset(word.bytes, word.charset)).join('');
}

/** 解一个邮件头值里的编码词；编码词之间只有空白时空白是折行留下的，不算内容。 */
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
