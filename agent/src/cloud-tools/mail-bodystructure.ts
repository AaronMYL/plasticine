import { mailProtocolError } from './mail-wire.ts';

type Part = string | Part[];
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
