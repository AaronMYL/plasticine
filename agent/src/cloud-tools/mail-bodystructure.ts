// IMAP BODYSTRUCTURE 的最小列表读取器：整封太大时只选正文（text/plain、text/html）和带 Content-ID 的内嵌图分段，
// 附件不下载。
import { mailProtocolError } from './mail-wire.ts';

type Part = string | Part[];
// 邮件正文结构只需有限嵌套，超过此范围拒绝，避免不受限递归或列表占用。
const MAX_STRUCTURE_DEPTH = 40;
const MAX_STRUCTURE_NODES = 10_000;
function structure(source: string): Part[] {
  const at = source.indexOf('BODYSTRUCTURE ');
  if (at < 0) { throw mailProtocolError(); }
  let position = at + 'BODYSTRUCTURE '.length;
  let nodes = 0;
  const read = (depth: number): Part => {
    if (depth > MAX_STRUCTURE_DEPTH || ++nodes > MAX_STRUCTURE_NODES) { throw mailProtocolError(); }
    while (/\s/.test(source[position] ?? '') && position < source.length) { position += 1; }
    const first = source[position++];
    if (first === '(') {
      const list: Part[] = [];
      while (position < source.length) {
        while (/\s/.test(source[position] ?? '') && position < source.length) { position += 1; }
        if (source[position] === ')') {
          position += 1;
          return list;
        }
        list.push(read(depth + 1));
      }
    } else if (first === '"') {
      let value = '';
      while (position < source.length) {
        const char = source[position++];
        if (char === '"') { return value; }
        if (char === '\\') { value += source[position++] ?? ''; }
        else { value += char; }
      }
    } else if (first !== undefined && first !== ')') {
      let value = first;
      while (position < source.length && !/[\s()]/.test(source[position] ?? '')) {
        value += source[position++];
      }
      return value;
    }
    throw mailProtocolError();
  };
  const parsed = read(0);
  if (!Array.isArray(parsed)) { throw mailProtocolError(); }
  return parsed;
}

export type MailPartKind = 'plain' | 'html' | 'image';

/** 太大的信只抓的分段：IMAP 分段号（不是 multipart 的信是 TEXT）、种类、字节数（编码后的）。 */
export interface MailPartPlan {
  path: string;
  kind: MailPartKind;
  size: number;
}

function isAttachment(part: Part[]): boolean {
  return part.some((entry) => Array.isArray(entry) && typeof entry[0] === 'string'
    && entry[0].toUpperCase() === 'ATTACHMENT');
}

function sizeOf(part: Part[]): number {
  const size = Number(part[6]);
  return Number.isSafeInteger(size) && size >= 0 ? size : 0;
}

/**
 * 整封超过抓取上限时，选出要抓的分段：正文的纯文字和 HTML，以及带 Content-ID 的图（HTML 里 cid: 引用的内嵌图）。
 * 附件不抓。单段的 body-fields 是 (类型 子类型 参数 id 描述 编码 大小 …)。
 */
export function mailParts(source: string): MailPartPlan[] {
  const plan: MailPartPlan[] = [];
  const visit = (part: Part[], path: string): void => {
    if (Array.isArray(part[0])) {
      for (let i = 0; Array.isArray(part[i]); i += 1) {
        visit(part[i] as Part[], path === '' ? String(i + 1) : `${path}.${i + 1}`);
      }
      return;
    }
    const type = String(part[0]).toUpperCase();
    const subtype = String(part[1]).toUpperCase();
    if (type === 'TEXT' && (subtype === 'PLAIN' || subtype === 'HTML') && !isAttachment(part)) {
      plan.push({ path: path || 'TEXT', kind: subtype === 'PLAIN' ? 'plain' : 'html', size: sizeOf(part) });
    } else if (type === 'IMAGE' && typeof part[3] === 'string' && part[3].toUpperCase() !== 'NIL'
      && path !== '') {
      plan.push({ path, kind: 'image', size: sizeOf(part) });
    }
  };
  visit(structure(source), '');
  return plan;
}
