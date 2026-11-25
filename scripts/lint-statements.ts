/**
 * Statement, ternary-depth, and test-hygiene token checks built on `lint-scan.ts`.
 */

import type { Token } from './lint-scan.ts';

export const MAX_TERNARY_DEPTH = 2;
export const CJK_PATTERN = /[\p{Script=Han}\u3000-\u303f\uff01-\uff60\uffe0-\uffef]/u;

const CONTINUES = new Set(['else', 'catch', 'finally']);
const TEST_CALLEES = new Set(['test', 'it', 'describe', 'suite']);

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}

/** Whether `code[index]` starts an object/interface type member rather than an executable statement. */
function startsTypeMember(code: Token[], index: number): boolean {
  const first = code[index];
  const second = code[index + 1];
  const third = code[index + 2];
  if (first === undefined) {
    return false;
  }
  if (first.text === '[' || first.text === 'readonly') {
    return true;
  }
  if (first.kind !== 'ident' && first.kind !== 'string' && first.kind !== 'number') {
    return false;
  }
  if (first.text === 'case' || first.text === 'default') {
    return false;
  }
  if (second?.text === ':' || (second?.text === '?' && third?.text === ':')) {
    return true;
  }
  const open = second?.text === '?' ? index + 2 : index + 1;
  if (code[open]?.text !== '(') {
    return false;
  }
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    const text = code[k]?.text;
    if (text === '(') {
      depth += 1;
    } else if (text === ')') {
      depth -= 1;
      if (depth === 0) {
        return code[k + 1]?.text === ':';
      }
    }
  }
  return false;
}

/** Tokens starting a second statement on the same line after a semicolon. */
export function crowdedStatements(source: string, code: Token[]): Token[] {
  const starts = lineStarts(source);
  const found: Token[] = [];
  const brackets: string[] = [];
  let templateEnd = -1;
  code.forEach((token, index) => {
    if (token.offset < templateEnd) {
      return;
    }
    if (token.kind === 'template') {
      templateEnd = token.offset + token.text.length;
      return;
    }
    if (token.kind !== 'punct') {
      return;
    }
    if (token.text === '(' || token.text === '[' || token.text === '{') {
      brackets.push(token.text);
    } else if (token.text === ')' || token.text === ']' || token.text === '}') {
      brackets.pop();
    } else if (token.text === ';') {
      const inner = brackets.at(-1);
      const next = code[index + 1];
      if ((inner !== undefined && inner !== '{') || next === undefined || next.text === '}') {
        return;
      }
      if (lineOf(starts, next.offset) !== lineOf(starts, token.offset)) {
        return;
      }
      if (!CONTINUES.has(next.text) && !startsTypeMember(code, index + 1)) {
        found.push(next);
      }
    }
  });
  return found;
}

interface Level {
  base: number;
  open: boolean[];
  sawExtends: boolean;
  until: number;
}

function isTernary(code: Token[], index: number): boolean {
  const previous = code[index - 1];
  const next = code[index + 1];
  if (next === undefined || previous === undefined) {
    return false;
  }
  if (previous.text === '?' || [')', ',', ']', '=', ';', '>', '}', ':', '?'].includes(next.text)) {
    return false;
  }
  const token = code[index];
  return !(next.text === '.' && token !== undefined && next.offset === token.offset + 1);
}

/**
 * Finds ternary operators nested deeper than `MAX_TERNARY_DEPTH`. Sibling branches (`a ? (b ? 1 : 2) : (c ? 3 : 4)`)
 * count as depth 2; chained else-if ternaries (`a ? 1 : b ? 2 : c ? 3 : 4`) count as depth 3.
 */
export function deepTernaries(source: string, code: Token[]): Token[] {
  const found: Token[] = [];
  const fresh = (base: number, until = Infinity): Level => ({ base, open: [], sawExtends: false, until });
  const levels: Level[] = [fresh(0)];
  const top = (): Level => levels.at(-1) as Level;
  let previousEnd = 0;
  code.forEach((token, index) => {
    while (levels.length > 1 && token.offset >= top().until) {
      levels.pop();
    }
    const level = top();
    if (level.until !== Infinity && source.slice(previousEnd, token.offset).includes('${')) {
      level.open = [];
      level.sawExtends = false;
    }
    previousEnd = token.kind === 'template' ? token.offset + 1 : token.offset + token.text.length;
    if (token.kind === 'template') {
      levels.push(fresh(0, token.offset + token.text.length));
      return;
    }
    if (token.kind === 'ident' && token.text === 'extends') {
      level.sawExtends = true;
      return;
    }
    if (token.kind !== 'punct') {
      return;
    }
    if (token.text === '(' || token.text === '[' || token.text === '{') {
      const before = code[index - 1];
      const called = before !== undefined && (before.kind === 'ident' || before.kind === 'template'
        || before.text === ')' || before.text === ']' || before.text === '>');
      levels.push(fresh(token.text === '(' && !called ? level.base + level.open.length : 0));
    } else if (token.text === ')' || token.text === ']' || token.text === '}') {
      if (levels.length > 1) {
        levels.pop();
      }
    } else if (token.text === ',' || token.text === ';' || token.text === '=>') {
      level.open = [];
      level.sawExtends = false;
    } else if (token.text === ':') {
      while (level.open.at(-1) === true) {
        level.open.pop();
      }
      if (level.open.length > 0) {
        level.open[level.open.length - 1] = true;
      }
      level.sawExtends = false;
    } else if (token.text === '?' && isTernary(code, index)) {
      if (level.sawExtends) {
        level.sawExtends = false;
        return;
      }
      level.open.push(false);
      if (level.base + level.open.length === MAX_TERNARY_DEPTH + 1) {
        found.push(token);
      }
    }
  });
  return found;
}

/** Finds unconditional test skips (`.skip(`, `.only(`, `.todo(`, and non-conditional `skip:` options). */
export function skippedTests(code: Token[]): Token[] {
  const found: Token[] = [];
  code.forEach((token, index) => {
    if (token.kind !== 'ident' || !['skip', 'only', 'todo'].includes(token.text)) {
      return;
    }
    const before = code[index - 1]?.text;
    const after = code[index + 1]?.text;
    if (before === '.' && after === '(') {
      const owner = code[index - 2]?.text ?? '';
      if (['test', 'it', 'describe', 'suite', 't', 'context'].includes(owner)) {
        found.push(token);
      }
      return;
    }
    if (token.text !== 'skip' || after !== ':' || (before !== '{' && before !== ',')) {
      return;
    }
    let depth = 0;
    let conditional = false;
    let reason = false;
    for (let k = index + 2; k < code.length; k += 1) {
      const text = code[k]?.text ?? '';
      if (text === '(' || text === '[' || text === '{') {
        depth += 1;
      } else if (text === ')' || text === ']' || text === '}') {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      } else if (text === ',' && depth === 0) {
        break;
      }
      conditional ||= text === '?';
      reason ||= code[k]?.kind === 'string' || code[k]?.kind === 'template';
    }
    if (!conditional || !reason) {
      found.push(token);
    }
  });
  return found;
}

/** Finds `test(...)`, `it(...)`, `describe(...)`, or `suite(...)` title literals containing CJK characters. */
export function cjkTestTitles(code: Token[]): Token[] {
  const found: Token[] = [];
  code.forEach((token, index) => {
    if (token.text !== '(') {
      return;
    }
    const prev = code[index - 1];
    if (prev?.kind !== 'ident') {
      return;
    }
    const isDirect = TEST_CALLEES.has(prev.text) && code[index - 2]?.text !== '.';
    const isModifier = code[index - 2]?.text === '.' && TEST_CALLEES.has(code[index - 3]?.text ?? '')
      && code[index - 4]?.text !== '.';
    if (!isDirect && !isModifier) {
      return;
    }
    let depth = 0;
    for (let k = index + 1; k < code.length; k += 1) {
      const current = code[k];
      if (current === undefined) {
        break;
      }
      if (current.text === '(' || current.text === '[' || current.text === '{') {
        depth += 1;
      } else if (current.text === ')' || current.text === ']' || current.text === '}') {
        if (depth === 0) {
          break;
        }
        depth -= 1;
      } else if (current.text === ',' && depth === 0) {
        break;
      } else if (depth === 0 && (current.kind === 'string' || current.kind === 'template')
        && CJK_PATTERN.test(current.text)) {
        found.push(current);
        break;
      }
    }
  });
  return found;
}
