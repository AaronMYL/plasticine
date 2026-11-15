// 两条写法规矩（plasticine-code 底线 1、2）：一行一个语句；三元最多套两层。
// TypeScript 7 不带解析器，这里只靠 lint-scan.ts 的词法：看分号后面同一行还有没有别的语句，数一条三元链上有几个问号。

import type { Token } from './lint-scan.ts';

export const MAX_TERNARY_DEPTH = 2;

/** 分号后面跟着这些词的不算下一个语句：它们接着上一句。 */
const CONTINUES = new Set(['else', 'catch', 'finally']);

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

/** 类型字面量里的成员（`a: string; b?: number`、`readonly c: T`、`[key: string]: T`）：不是语句。 */
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
  // 方法签名：`close(): void`、`end?(): void`——括号后面紧跟冒号
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

/** 一行上分号后面还有别的语句的地方（返回后面那个语句的第一个词）。 */
export function crowdedStatements(source: string, code: Token[]): Token[] {
  const starts = lineStarts(source);
  const found: Token[] = [];
  const brackets: string[] = [];
  // 模板字符串里 ${ } 的词排在模板那个词后面，位置落在模板里面：它们不是语句，跳过。
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
  /** 这一层开头时外面已经套了几层（分组用的圆括号接着外面数，调用、数组、花括号从 0 数）。 */
  base: number;
  /** 这一层里还没结束的三元：true 表示已经过了它的冒号，在「否则」那一支。 */
  open: boolean[];
  /** 上一个问号或冒号之后出现过 extends：下一个问号是条件类型，不是三元。 */
  sawExtends: boolean;
  /** 模板字符串里的 ${ }：位置过了这里就出这一层。 */
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
  // `a?.b`：问号紧跟着点
  return !(next.text === '.' && token !== undefined && next.offset === token.offset + 1);
}

/**
 * 套了超过两层的三元（每处报一次，报在第三层的问号上）。并排的两支各套一层不算三层：
 * `a ? (b ? 1 : 2) : (c ? 3 : 4)` 是两层，`a ? 1 : b ? 2 : c ? 3 : 4` 是三层。
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
    // 同一个模板字符串里的下一个 ${ }：是另一个表达式，从头数
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
      // 这个冒号属于最里面那个还在「是」那一支的三元；已经在「否则」那一支的到这里结束
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

/** 无条件跳过的测试：`.skip(`、`.only(`、`.todo(`，和不是「条件 ? '原因' : false」的 `skip:` 选项。 */
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
    // 选项里的 skip:：读到这一项结束，要有一个问号和一句原因
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
