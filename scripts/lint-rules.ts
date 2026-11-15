// Rules from plasticine-code SKILL.md, "底线" and "代码长什么样". 11-15 起格式和写法都算错误（以前只提醒）。
// Kept separate from the file walker so each rule can be tested on plain strings.

import { explicitAnys } from './lint-any.ts';
import { crowdedCssLines, misalignedCssBraces } from './lint-css.ts';
import { scan, type Token } from './lint-scan.ts';
import { MAX_TERNARY_DEPTH, crowdedStatements, deepTernaries, skippedTests } from './lint-statements.ts';

export const MAX_LINE_WIDTH = 120;
// 源码 500 行是软上限：超过了看看它是不是干了不止一件事。确认只干一件事的登记在下面并写原因（只提醒）；
// 没登记的超过上限算错误。CSS 一行一条声明、本来就长，上限放到 800。测试文件不限长度。
export const MAX_FILE_LINES = 500;
export const MAX_CSS_LINES = 800;

/** 可以超过上限的文件和原因：只干一件事，拆开反而要来回翻。新加一条要写清原因。 */
export const LONG_FILES_ALLOWED: Readonly<Record<string, string>> = {
  'agent/src/app/router.ts': '路由一张表：每个接口的地址、方法、要不要登录、谁来处理',
  'client/src/shell/routes.ts': '地址一张表：每种页面的地址怎么写、怎么读',
  'agent/src/network/service.ts': '网络这一头对外的总入口：每个方法都很薄，拆开调用方就得认两个对象',
  'agent/src/lines/kernel.ts': '线的状态机，线的状态只经这一个类改。还没拆：要先设计几块怎么共用私有状态，单独一批做',
  'agent/src/lines/runner.ts': '一条线的一次运行（一个类）。和 kernel.ts 一起单独一批拆',
  'client/src/api/fake/fake-contacts.ts': '假接口：一个资源一份，和真接口的资源文件一一对应',
  'client/src/api/fake/fake-lines.ts': '假接口：一个资源一份，和真接口的资源文件一一对应',
  'client/src/api/fake/fake-books.ts': '假接口：一个资源一份，和真接口的资源文件一一对应',
  'client/src/mac/page-operate.ts': '注入网页的脚本：打包成一段字符串塞进网页，必须自成一个文件',
  'client/src/mac/translate-page.ts': '注入网页的脚本：打包成一段字符串塞进网页，必须自成一个文件',
  'client/src/views/site/site.css': '官网一整页的样式（另一套设计，不和 App 的样式混）',
  'client/src/shell/base.css': '全站基础样式；界面规矩的检查按这个文件名找它',
};

/** 文件名用了里程碑或批次（m5b-…、第13批-…）：名字要说它是什么。 */
export function isMilestoneName(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? '';
  return /^(m\d+[a-z]?|第\s*\d+\s*批|batch-?\d+)[-_.]/i.test(name);
}

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
  /** Test files: no length limit; skipped tests are reported. */
  isTest?: boolean;
  /** CSS: one declaration per line. */
  isCss?: boolean;
  /** Repository-relative path with forward slashes, for LONG_FILES_ALLOWED. */
  path?: string;
  /** 这个仓库自己登记的「可以超过上限」的原因（lint.ts 从 scripts/lint-local.json 读）。 */
  longReason?: string;
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

  const maxLines = options.isCss === true ? MAX_CSS_LINES : MAX_FILE_LINES;
  if (options.isTest !== true && lineCount > maxLines) {
    const reason = options.longReason ?? (options.path === undefined ? undefined : LONG_FILES_ALLOWED[options.path]);
    findings.push({
      line: maxLines + 1,
      rule: 'file-length',
      message: reason === undefined
        ? `文件 ${lineCount} 行，超过 ${maxLines} 行；按职责拆分，或者登记进 LONG_FILES_ALLOWED 并写原因`
        : `文件 ${lineCount} 行，登记过可以超过 ${maxLines} 行：${reason}`,
      severity: reason === undefined ? 'error' : 'warning',
    });
  }

  lines.forEach((text, index) => {
    const width = visibleWidth(text);
    if (width > MAX_LINE_WIDTH) {
      const message = `这一行 ${width} 字符，超过 ${MAX_LINE_WIDTH}`;
      findings.push({ line: index + 1, rule: 'line-width', message, severity: 'error' });
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
      findings.push({ line: lineAt(source, token.offset), rule: 'no-any', message, severity: 'error' });
    }
    for (const token of crowdedStatements(source, code)) {
      const message = '一行一个语句：分号后面的语句另起一行';
      findings.push({ line: lineAt(source, token.offset), rule: 'one-statement', message, severity: 'error' });
    }
    for (const token of deepTernaries(source, code)) {
      const message = `三元最多套 ${MAX_TERNARY_DEPTH} 层：改成 if、查表或拆成小函数`;
      findings.push({ line: lineAt(source, token.offset), rule: 'nested-ternary', message, severity: 'error' });
    }
    for (const token of options.isTest === true ? skippedTests(code) : []) {
      const message = "测试不许无条件跳过：删掉，或写成 skip: 条件 ? '原因' : false";
      findings.push({ line: lineAt(source, token.offset), rule: 'no-skipped-test', message, severity: 'error' });
    }
  }

  for (const line of options.isCss === true ? crowdedCssLines(source) : []) {
    const message = 'CSS 一行一条声明：展开成每条一行';
    findings.push({ line, rule: 'css-one-declaration', message, severity: 'error' });
  }
  for (const line of options.isCss === true ? misalignedCssBraces(source) : []) {
    const message = '收尾的 } 和这条规则开头那一行对齐';
    findings.push({ line, rule: 'css-brace-indent', message, severity: 'error' });
  }

  return findings.sort((a, b) => a.line - b.line);
}
