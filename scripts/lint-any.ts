// Finds explicit `any` types among code tokens. Only `any` in a type counts; a value named `any` (`f(any)`,
// `{ value: any }`, `a < any`, `const n = any`) does not. This is a token-level approximation of TypeScript's
// grammar: from each `any` it walks back to whatever set the context — an annotation colon, `as`, a type
// alias, type arguments, an interface body — and asks whether that context is a type.

import type { Token } from './lint-scan.ts';

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);
// After these keywords the next thing is a type.
const TYPE_KEYWORDS = new Set(['as', 'keyof', 'extends', 'satisfies', 'implements']);
// Reaching one of these while walking back means the `any` sits in a value expression or statement.
const VALUE_KEYWORDS = new Set(['const', 'let', 'var', 'return', 'throw', 'yield', 'await', 'if', 'while', 'for',
  'case', 'new', 'delete', 'void', 'typeof', 'in', 'of', 'function', 'else', 'do', 'switch']);
const DECLARATION_KEYWORDS = new Set(['const', 'let', 'var']);
// A `{` right after `interface X …` or `class X …` opens a body whose members are annotated with types.
const TYPE_BODY_KEYWORDS = new Set(['interface', 'class']);

function textAt(code: Token[], j: number): string {
  return code[j]?.text ?? '';
}

/** Index of the opener matching the closer at `close`, or -1. */
function openerFor(code: Token[], close: number): number {
  let depth = 0;
  for (let j = close; j >= 0; j -= 1) {
    const text = textAt(code, j);
    if (CLOSE.has(text) || text === '>') {
      depth += 1;
    } else if (OPEN.has(text) || text === '<') {
      depth -= 1;
      if (depth === 0) {
        return j;
      }
    }
  }
  return -1;
}

/** A `<` starts type arguments when a matching `>` follows before the statement ends; otherwise it compares. */
function isGenericOpen(code: Token[], open: number): boolean {
  const before = code[open - 1];
  if (before?.kind !== 'ident' && ![')', ']', '>'].includes(before?.text ?? '')) {
    return false;
  }
  let depth = 0;
  let angles = 0;
  for (let j = open + 1; j < code.length; j += 1) {
    const text = textAt(code, j);
    if (depth === 0 && ['&&', '||', '==', '!='].includes(text + textAt(code, j + 1))) {
      return false;
    }
    if (OPEN.has(text)) {
      depth += 1;
    } else if (CLOSE.has(text)) {
      if (depth === 0) {
        return false;
      }
      depth -= 1;
    } else if (depth === 0 && [';', '&&', '||', '+', '-', '===', '!==', '==', '!='].includes(text)) {
      return false;
    } else if (depth === 0 && text === '<') {
      angles += 1;
    } else if (depth === 0 && text === '>') {
      if (angles === 0) {
        return true;
      }
      angles -= 1;
    }
  }
  return false;
}

/** `type Name = …` or `type Name<T> = …`. */
function isTypeAliasEquals(code: Token[], equals: number): boolean {
  let j = equals - 1;
  if (textAt(code, j) === '>') {
    j = openerFor(code, j) - 1;
  }
  return code[j]?.kind === 'ident' && textAt(code, j - 1) === 'type';
}

/** The innermost bracket still open at code[k] (`<` only when it opens type arguments), or -1. */
function enclosingOpener(code: Token[], k: number): number {
  let depth = 0;
  for (let j = k - 1; j >= 0; j -= 1) {
    const text = textAt(code, j);
    if (CLOSE.has(text) || text === '>') {
      depth += 1;
    } else if (OPEN.has(text) || text === '<') {
      if (depth > 0) {
        depth -= 1;
      } else if (text !== '<' || isGenericOpen(code, j)) {
        return j;
      }
    } else if (depth === 0 && text === ';') {
      return -1;
    }
  }
  return -1;
}

/** `{` opens a type when it is an interface or class body, or when it stands where a type is expected. */
function braceIsType(code: Token[], brace: number): boolean {
  for (let j = brace - 1; j >= 0; j -= 1) {
    const token = code[j];
    const text = textAt(code, j);
    if (text === '>') {
      j = openerFor(code, j);
    } else if (token?.kind === 'ident' && TYPE_BODY_KEYWORDS.has(text)) {
      return true;
    } else if (token?.kind !== 'ident' && text !== '.' && text !== ',') {
      break;
    }
  }
  return inTypeContext(code, brace);
}

/** Whether the colon at `colon` annotates a type, rather than separating an object property or a ternary. */
function colonIsAnnotation(code: Token[], colon: number): boolean {
  if (textAt(code, colon - 1) === ')') {
    const open = openerFor(code, colon - 1);
    const name = code[open - 1];
    const beforeName = textAt(code, open - 2);
    if (name?.kind === 'ident' && ['function', '{', '}', ',', ';', 'async', 'static'].includes(beforeName)) {
      return true;
    }
  }
  if (textAt(code, colon - 1) === '?') {
    return true;
  }
  let depth = 0;
  for (let j = colon - 1; j >= 0; j -= 1) {
    const text = textAt(code, j);
    if (CLOSE.has(text)) {
      depth += 1;
    } else if (OPEN.has(text)) {
      if (depth > 0) {
        depth -= 1;
      } else {
        return text === '{' ? braceIsType(code, j) : true;
      }
    } else if (depth === 0 && text === '?') {
      // A ternary's colon: a type only inside a conditional type.
      return inTypeContext(code, j);
    } else if (depth === 0 && (text === 'case' || text === 'default')) {
      return false;
    } else if (depth === 0 && DECLARATION_KEYWORDS.has(text)) {
      // `const x: T` inside a block: the colon annotates the variable before any enclosing `{` is reached.
      return true;
    } else if (depth === 0 && text === ';') {
      return true;
    }
  }
  return true;
}

/** `() => any` is a function type only when its parameter list itself stands where a type is expected. */
function arrowIsType(code: Token[], arrow: number): boolean {
  if (textAt(code, arrow - 1) !== ')') {
    return false;
  }
  return inTypeContext(code, openerFor(code, arrow - 1));
}

/** Whether the token at code[k] is in a type position. */
export function inTypeContext(code: Token[], k: number): boolean {
  let depth = 0;
  for (let j = k - 1; j >= 0; j -= 1) {
    const token = code[j];
    const text = textAt(code, j);
    if (CLOSE.has(text) || text === '>') {
      depth += 1;
      continue;
    }
    if (OPEN.has(text) || text === '<') {
      if (depth > 0) {
        depth -= 1;
      } else if (text === '<') {
        if (isGenericOpen(code, j)) {
          return true;
        }
      } else {
        return text === '{' ? braceIsType(code, j) : inTypeContext(code, j);
      }
      continue;
    }
    if (depth > 0) {
      continue;
    }
    if (text === ':') {
      return colonIsAnnotation(code, j);
    }
    if (text === '=>') {
      return arrowIsType(code, j);
    }
    if (text === '=') {
      // A type alias, or a type parameter's default (`<T = any>`); any other `=` assigns a value.
      const opener = enclosingOpener(code, j);
      return isTypeAliasEquals(code, j) || (opener >= 0 && textAt(code, opener) === '<');
    }
    if (token?.kind === 'ident' && TYPE_KEYWORDS.has(text)) {
      return true;
    }
    if (text === ';' || (token?.kind === 'ident' && VALUE_KEYWORDS.has(text))) {
      return false;
    }
  }
  return false;
}

export function explicitAnys(code: Token[]): Token[] {
  return code.filter((token, k) => {
    const next = textAt(code, k + 1);
    const memberStarts = ['{', ';', ',', '(', 'readonly', 'public', 'private', 'protected'];
    const namedPosition = memberStarts.includes(textAt(code, k - 1));
    const memberName = namedPosition && (next === ':' || (next === '?' && textAt(code, k + 2) === ':'));
    return token.kind === 'ident' && token.text === 'any' && !memberName && inTypeContext(code, k);
  });
}
