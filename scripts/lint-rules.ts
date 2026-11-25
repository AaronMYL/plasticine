/**
 * Core repository lint rules: file length, line width, comment hygiene, explicit `any`, empty `catch`,
 * single-statement lines, ternary depth, test hygiene, and CSS formatting.
 */

import { explicitAnys } from './lint-any.ts';
import { crowdedCssLines, cssComments, misalignedCssBraces } from './lint-css.ts';
import { scan, type Token } from './lint-scan.ts';
import {
  CJK_PATTERN, MAX_TERNARY_DEPTH, cjkTestTitles, crowdedStatements, deepTernaries, skippedTests,
} from './lint-statements.ts';

export const MAX_LINE_WIDTH = 120;
export const MAX_FILE_LINES = 500;
export const MAX_CSS_LINES = 800;

/** Files allowed to exceed the soft line limit because splitting them would fragment a single cohesive unit. */
export const LONG_FILES_ALLOWED: Readonly<Record<string, string>> = {
  'agent/src/app/router.ts': 'Single route registry mapping endpoints, methods, auth requirements, and handlers',
  'client/src/shell/routes.ts': 'Single client route table defining URL hash parsing and formatting',
  'agent/src/network/service.ts': 'Thin facade exposing the network subsystem through one cohesive entrypoint',
  'agent/src/lines/kernel.ts': 'State machine governing all line state transitions within a single class',
  'agent/src/lines/runner.ts': 'Single-run execution lifecycle class paired with LineKernel',
  'client/src/api/fake/fake-contacts.ts': 'Fake API resource mirroring its corresponding server resource file',
  'client/src/api/fake/fake-lines.ts': 'Fake API resource mirroring its corresponding server resource file',
  'client/src/api/fake/fake-books.ts': 'Fake API resource mirroring its corresponding server resource file',
  'client/src/mac/page-operate.ts': 'Self-contained injected page script bundled as a single string',
  'client/src/mac/translate-page.ts': 'Self-contained injected page script bundled as a single string',
  'client/src/views/site/site.css': 'Standalone landing page stylesheet isolated from application styles',
  'client/src/shell/base.css': 'Global base stylesheet referenced directly by layout rule checks',
};

const ALLOWED_DIRECTIVE = new RegExp(
  '^(?:'
  + '// SPDX-License-Identifier: \\S+|'
  + '// swift-tools-version:\\s*\\S+|'
  + '// (?:BEGIN|END) generated \\S+|'
  + '// @(?:ts-expect-error|ts-ignore)\\b|'
  + '/\\* @vite-ignore \\*/|'
  + '(?://|/\\*) allow-exception: \\S+|'
  + '// (?:Invariant|Workaround): \\S+'
  + ')',
);

/** Rejects milestone or batch prefixes (`m5b-...`, `batch-2-...`) so file names describe responsibility. */
export function isMilestoneName(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? '';
  return /^(m\d+[a-z]?|第\s*\d+\s*批|batch-?\d+)[-_.]/i.test(name);
}

export type LintSeverity = 'error' | 'warning';
export type CommentStyle = 'c' | 'c-doc-slash' | 'css' | 'hash' | 'python' | 'html' | 'nsis';

export interface LintFinding {
  line: number;
  rule: string;
  message: string;
  severity: LintSeverity;
}

export interface LintOptions {
  checkCode: boolean;
  isTest?: boolean;
  isCss?: boolean;
  commentStyle?: CommentStyle;
  path?: string;
  longReason?: string;
}

/** Matches `*.test.*` files and helper/fixture files inside `tests/` or `PlasticineDeviceTests/`. */
export function isTestFile(path: string): boolean {
  const parts = path.split(/[\\/]/);
  return /\.test\.[cm]?[jt]sx?$/.test(path) || parts.includes('tests') || parts.includes('PlasticineDeviceTests');
}

/** Counts Unicode code points rather than UTF-16 code units. */
export function visibleWidth(text: string): number {
  return Array.from(text).length;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

function isLineStart(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  return source.slice(lineStart, offset).trim() === '';
}

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

function checkCodeComments(source: string, comments: Token[], allowTripleSlash: boolean): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const token of comments) {
    const line = lineAt(source, token.offset);
    if (CJK_PATTERN.test(token.text)) {
      findings.push({
        line,
        rule: 'no-cjk-comment',
        message: 'Comments must not contain Chinese characters',
        severity: 'error',
      });
    }
    const isJsDoc = token.text.startsWith('/**') && !token.text.startsWith('/***') && isLineStart(source, token.offset);
    const isDocSlash = allowTripleSlash && token.text.startsWith('///') && isLineStart(source, token.offset);
    if (!isJsDoc && !isDocSlash && !ALLOWED_DIRECTIVE.test(token.text)) {
      findings.push({
        line,
        rule: 'no-inline-comment',
        message: 'Inline comments are disallowed; use JSDoc (/** ... */) or self-explanatory code',
        severity: 'error',
      });
    }
  }
  return findings;
}

function checkOtherComments(source: string, style: CommentStyle): LintFinding[] {
  const findings: LintFinding[] = [];
  if (style === 'css') {
    for (const comment of cssComments(source)) {
      const line = lineAt(source, comment.offset);
      if (CJK_PATTERN.test(comment.text)) {
        findings.push({
          line, rule: 'no-cjk-comment', message: 'Comments must not contain Chinese characters', severity: 'error',
        });
      }
      const isDoc = comment.text.startsWith('/**') && !comment.text.startsWith('/***')
        && isLineStart(source, comment.offset);
      const isException = /^\/\* allow-exception: \S+/.test(comment.text);
      if (!isDoc && !isException) {
        findings.push({
          line,
          rule: 'no-inline-comment',
          message: 'CSS inline comments are disallowed; use /** ... */ section docs or /* allow-exception: <reason> */',
          severity: 'error',
        });
      }
    }
    return findings;
  }
  if (style === 'html') {
    for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
      if (CJK_PATTERN.test(match[0])) {
        findings.push({
          line: lineAt(source, match.index),
          rule: 'no-cjk-comment',
          message: 'HTML comments must not contain Chinese characters',
          severity: 'error',
        });
      }
    }
    return findings;
  }
  if (style === 'python') {
    for (const match of source.matchAll(/(?:"""[\s\S]*?"""|'''[\s\S]*?'''|^\s*#(?!!).*$)/gm)) {
      if (CJK_PATTERN.test(match[0])) {
        findings.push({
          line: lineAt(source, match.index),
          rule: 'no-cjk-comment',
          message: 'Comments and docstrings must not contain Chinese characters',
          severity: 'error',
        });
      }
    }
    return findings;
  }
  const linePrefix = style === 'nsis' ? /^\s*;/ : /^\s*#(?!!)/;
  source.split('\n').forEach((text, index) => {
    if (linePrefix.test(text) && CJK_PATTERN.test(text)) {
      findings.push({
        line: index + 1,
        rule: 'no-cjk-comment',
        message: 'Comments must not contain Chinese characters',
        severity: 'error',
      });
    }
  });
  return findings;
}

export function lintSource(source: string, options: LintOptions): LintFinding[] {
  const findings: LintFinding[] = [];
  const lines = source.split('\n');
  const lineCount = source.endsWith('\n') ? lines.length - 1 : lines.length;

  const maxLines = options.isCss === true ? MAX_CSS_LINES : MAX_FILE_LINES;
  if (options.isTest !== true && lineCount > maxLines) {
    const reason = options.longReason ?? (options.path === undefined ? undefined : LONG_FILES_ALLOWED[options.path]);
    findings.push({
      line: maxLines + 1,
      rule: 'file-length',
      message: reason === undefined
        ? `File has ${lineCount} lines (limit ${maxLines}); split by responsibility or register in LONG_FILES_ALLOWED`
        : `File has ${lineCount} lines (allowed above ${maxLines}: ${reason})`,
      severity: reason === undefined ? 'error' : 'warning',
    });
  }

  const checkWidth = options.checkCode || options.isCss === true;
  if (checkWidth) {
    lines.forEach((text, index) => {
      const width = visibleWidth(text);
      if (width > MAX_LINE_WIDTH) {
        const message = `Line is ${width} characters wide (limit ${MAX_LINE_WIDTH})`;
        findings.push({ line: index + 1, rule: 'line-width', message, severity: 'error' });
      }
    });
  }

  const style: CommentStyle | undefined = options.commentStyle
    ?? (options.checkCode ? 'c' : options.isCss === true ? 'css' : undefined);

  if (options.checkCode || style === 'c' || style === 'c-doc-slash') {
    const tokens = scan(source);
    const comments = tokens.filter((token) => token.kind === 'comment');
    findings.push(...checkCodeComments(source, comments, style === 'c-doc-slash'));
    if (options.checkCode) {
      const code = tokens.filter((token) => token.kind !== 'comment');
      for (const token of emptyCatches(code)) {
        const message = 'Empty catch swallows errors; handle, rethrow with context, or log explicitly';
        findings.push({ line: lineAt(source, token.offset), rule: 'empty-catch', message, severity: 'error' });
      }
      for (const token of explicitAnys(code)) {
        const message = 'Explicit `any` is disallowed; validate external inputs against a schema';
        findings.push({ line: lineAt(source, token.offset), rule: 'no-any', message, severity: 'error' });
      }
      for (const token of crowdedStatements(source, code)) {
        const message = 'One statement per line; move statements after `;` onto a new line';
        findings.push({ line: lineAt(source, token.offset), rule: 'one-statement', message, severity: 'error' });
      }
      for (const token of deepTernaries(source, code)) {
        const message = `Ternary nesting exceeds ${MAX_TERNARY_DEPTH} levels; use if/else, lookup tables, or helpers`;
        findings.push({ line: lineAt(source, token.offset), rule: 'nested-ternary', message, severity: 'error' });
      }
      if (options.isTest === true) {
        for (const token of skippedTests(code)) {
          const message = "Unconditional test skip is disallowed; delete or use `skip: cond ? false : 'reason'`";
          findings.push({ line: lineAt(source, token.offset), rule: 'no-skipped-test', message, severity: 'error' });
        }
        for (const token of cjkTestTitles(code)) {
          const message = 'Test and suite titles must be written in English';
          findings.push({ line: lineAt(source, token.offset), rule: 'no-cjk-test-title', message, severity: 'error' });
        }
      }
    }
  } else if (style !== undefined) {
    findings.push(...checkOtherComments(source, style));
  }

  for (const line of options.isCss === true ? crowdedCssLines(source) : []) {
    const message = 'CSS rules allow at most one declaration per line';
    findings.push({ line, rule: 'css-one-declaration', message, severity: 'error' });
  }
  for (const line of options.isCss === true ? misalignedCssBraces(source) : []) {
    const message = 'Closing `}` must align with the start of its rule';
    findings.push({ line, rule: 'css-brace-indent', message, severity: 'error' });
  }

  return findings.sort((a, b) => a.line - b.line);
}
