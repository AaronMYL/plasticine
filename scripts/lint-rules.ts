// Rules from plasticine-code SKILL.md, "底线四条" and "代码长什么样".
// Kept separate from the file walker so each rule can be tested on plain strings.

import { explicitAnys } from './lint-any.ts';
import { scan, type Token } from './lint-scan.ts';

export const MAX_LINE_WIDTH = 120;
// A soft limit (decision 87): past it the file is reported as a warning, a hint to check it still has one job;
// it never fails the lint. Test files have no length limit.
export const MAX_FILE_LINES = 500;

/** `error` fails the lint; `warning` is printed and left to judgement. */
export type LintSeverity = 'error' | 'warning';

export interface LintFinding {
  line: number;
  rule: string;
  message: string;
  severity: LintSeverity;
}

export interface LintOptions {
  /** Look at code tokens (empty catch, explicit any), not only line widths. */
  checkCode: boolean;
  /** Test files: no length limit. */
  isTest?: boolean;
}

/** Test files: `*.test.ts` anywhere, and everything under a `tests` directory (helpers, fixtures). */
export function isTestFile(path: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/.test(path) || path.split(/[\\/]/).includes('tests');
}

/** Counts code points so Chinese text is measured by characters, not UTF-16 units. */
export function visibleWidth(text: string): number {
  return Array.from(text).length;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/** Index of the matching `)` for the `(` at `open`, counting only code tokens. */
function closingParen(code: Token[], open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    const text = code[k]?.text;
    if (text === '(') {
      depth += 1;
    } else if (text === ')') {
      depth -= 1;
      if (depth === 0) {
        return k;
      }
    }
  }
  return code.length;
}

/** A catch block whose body holds no code at all (comments alone still swallow the error). */
function followsTry(code: Token[], index: number): boolean {
  if (code[index - 1]?.text !== '}') {
    return false;
  }
  let depth = 0;
  for (let j = index - 1; j >= 0; j -= 1) {
    if (code[j]?.text === '}') {
      depth += 1;
    } else if (code[j]?.text === '{') {
      depth -= 1;
      if (depth === 0) {
        return code[j - 1]?.text === 'try';
      }
    }
  }
  return false;
}

function emptyCatches(code: Token[]): Token[] {
  const found: Token[] = [];
  code.forEach((token, k) => {
    if (token.kind !== 'ident' || token.text !== 'catch' || !followsTry(code, k)) {
      return;
    }
    let brace = k + 1;
    if (code[brace]?.text === '(') {
      brace = closingParen(code, brace) + 1;
    }
    if (code[brace]?.text === '{' && code[brace + 1]?.text === '}') {
      found.push(token);
    }
  });
  return found;
}

export function lintSource(source: string, options: LintOptions): LintFinding[] {
  const findings: LintFinding[] = [];
  const lines = source.split('\n');
  const lineCount = source.endsWith('\n') ? lines.length - 1 : lines.length;

  if (options.isTest !== true && lineCount > MAX_FILE_LINES) {
    findings.push({
      line: MAX_FILE_LINES + 1,
      rule: 'file-length',
      message: `文件 ${lineCount} 行，超过 ${MAX_FILE_LINES} 行；看看是不是该按职责拆分`,
      severity: 'warning',
    });
  }

  lines.forEach((text, index) => {
    const width = visibleWidth(text);
    if (width > MAX_LINE_WIDTH) {
      const message = `这一行 ${width} 字符，超过 ${MAX_LINE_WIDTH}`;
      // 第 98 条：纯格式只提醒，不挡推送和自迭代上线。
      findings.push({ line: index + 1, rule: 'line-width', message, severity: 'warning' });
    }
  });

  if (options.checkCode) {
    const code = scan(source).filter((token) => token.kind !== 'comment');
    for (const token of emptyCatches(code)) {
      const message = '空的 catch 会吞掉错误：处理、带上下文抛出或记日志';
      findings.push({ line: lineAt(source, token.offset), rule: 'empty-catch', message, severity: 'error' });
    }
    for (const token of explicitAnys(code)) {
      const message = '不写 any；外部输入先过 schema 校验';
      // 第 98 条：类型写法只提醒；真正的类型错误由 typecheck 拦。
      findings.push({ line: lineAt(source, token.offset), rule: 'no-any', message, severity: 'warning' });
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}
