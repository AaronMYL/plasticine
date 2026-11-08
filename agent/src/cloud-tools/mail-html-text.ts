// 邮件正文转成给搜索、脑和列表预览用的纯文字。旧版只还原四个实体、`\s+ → ' '` 把整封压成一行（线上 Reddit 一封 3169
// 字一行、133 个 &#…;）。这里：头部、样式、脚本、注释不要；段落类元素前后空一行，行类元素（li、tr、div…）换一行，<br>
// 换行，表格一格一个空格；实体全部还原；营销信里成百的零宽字符去掉；三个以上的空行收成一个。

import { NAMED_ENTITIES } from './mail-entities.ts';

// 零宽空格 / 连接符 / 不连接符、词连接符、BOM、软连字符、组合字形连接符（营销信预览行的填充）、蒙古文元音分隔符。
const ZERO_WIDTH = /[​‌‍⁠﻿­͏᠎]/g;
// 文字里不该有的控制字符（下面要借 \u0001、\u0002 当行和段的记号）。
const CONTROL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g;
const LINE_MARK = '\u0001';
const PARAGRAPH_MARK = '\u0002';
const PARAGRAPH_TAGS = 'address|article|aside|blockquote|center|dl|figure|footer|form|h[1-6]|header|hr|main|nav|ol'
  + '|p|pre|section|table|ul';
const LINE_TAGS = 'caption|dd|div|dt|figcaption|li|tr';
const DROPPED_BLOCKS = /<(head|style|script|title|noscript|template|xml)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi;
const MAX_CODE_POINT = 0x10ffff;
// HTML 标准：数字实体 128–159 按 Windows-1252 读（老邮件里的 &#146; 是右单引号）。
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

/** 还原 HTML 实体：数字实体全部，命名实体按 mail-entities.ts 的表；不认得的原样留着。 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g,
    (whole, body: string) => {
      if (body.startsWith('#')) {
        return numericEntity(whole, body);
      }
      return NAMED_ENTITIES[body] ?? whole;
    });
}

/** 纯文字的收拾：换行统一、零宽字符去掉、不换行空格当空格、行尾空白去掉、三个以上空行收成一个。 */
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

/** 一串行 / 段记号（夹着空格）收成一个换行；里面有段记号就空一行。 */
function breaks(run: string): string {
  return run.includes(PARAGRAPH_MARK) ? '\n\n' : '\n';
}

export function htmlToText(html: string): string {
  const marked = html.replace(CONTROL, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(DROPPED_BLOCKS, '')
    // HTML 的空白规则：源码里的换行和连续空白只算一个空格；换行由下面的元素决定。
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
