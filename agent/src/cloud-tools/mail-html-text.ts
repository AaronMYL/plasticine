import { NAMED_ENTITIES } from './mail-entities.ts';

const ZERO_WIDTH = /[​‌‍⁠﻿­͏᠎]/g;
const CONTROL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g;
const LINE_MARK = '\u0001';
const PARAGRAPH_MARK = '\u0002';
const PARAGRAPH_TAGS = 'address|article|aside|blockquote|center|dl|figure|footer|form|h[1-6]|header|hr|main|nav|ol'
  + '|p|pre|section|table|ul';
const LINE_TAGS = 'caption|dd|div|dt|figcaption|li|tr';
const DROPPED_BLOCKS = /<(head|style|script|title|noscript|template|xml)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const MAX_CODE_POINT = 0x10ffff;
const WINDOWS_1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ'
  + '\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

function numericEntity(whole: string, body: string): string {
  const hex = body[1] === 'x' || body[1] === 'X';
  const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
  if (!Number.isSafeInteger(code) || code > MAX_CODE_POINT || (code >= 0xd800 && code <= 0xdfff)) {
    return whole;
  }
  if (code === 0) {
    return '�';
  }
  if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
    return '';
  }
  if (code >= 0x80 && code <= 0x9f) {
    return WINDOWS_1252[code - 0x80] ?? whole;
  }
  return String.fromCodePoint(code);
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (whole, body: string) => {
      if (body.startsWith('#')) {
        return numericEntity(whole, body);
      }
      return NAMED_ENTITIES[body] ?? whole;
    });
}

export function cleanMailText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function breaks(run: string): string {
  return run.includes(PARAGRAPH_MARK) ? '\n\n' : '\n';
}

export function htmlToText(html: string): string {
  const marked = html.replace(CONTROL, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(DROPPED_BLOCKS, '')
    .replace(/[ \t\r\n\f]+/g, ' ')
    .replace(/<br\b[^>]*>/gi, '\n')
    .replace(new RegExp(`<\\/?(?:${PARAGRAPH_TAGS})\\b[^>]*>`, 'gi'), PARAGRAPH_MARK)
    .replace(new RegExp(`<\\/?(?:${LINE_TAGS})\\b[^>]*>`, 'gi'), LINE_MARK)
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<\/?[A-Za-z][^>]*>/g, '');
  const text = decodeEntities(marked)
    .replace(ZERO_WIDTH, '')
    .replace(/ /g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/[ \u0001\u0002]*[\u0001\u0002][ \u0001\u0002]*/g, breaks)
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  return cleanMailText(text);
}
