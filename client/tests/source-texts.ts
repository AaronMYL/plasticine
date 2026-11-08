// 扫客户端源码和两端共用的 agent/shared 里的字符串和 JSX 文字（不扫注释、测试和假接口的示例数据）：界面用词的几条守卫
// （ui-words.test.ts、ui-single-char.test.ts）共用这一份扫描器。

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..');
export const SCANNED = [join(ROOT, 'client', 'src'), join(ROOT, 'agent', 'shared')];
const SKIPPED = [/\.test\.tsx?$/, /[\\/]fake[\\/]/];
/** 模板里的 ${…} 换成这个字符再看，「· w ${…}」才认得出是权重。 */
export const HOLE = '⟨⟩';
const CJK = /[一-鿿]/u;

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    const source = /\.tsx?$/.test(name) && !SKIPPED.some((pattern) => pattern.test(path));
    return source ? [path] : [];
  });
}

/** 一个字符之前最近的非空白字符：判断「/」是除号还是正则。 */
function previousSignificant(text: string, index: number): string {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (!/\s/.test(text[at] ?? '')) {
      return text[at] ?? '';
    }
  }
  return '';
}

/** 跳过一个正则字面量，返回它后面的位置。 */
function skipRegex(text: string, start: number): number {
  let inClass = false;
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at];
    if (char === '\\') {
      at += 1;
    } else if (char === '[') {
      inClass = true;
    } else if (char === ']') {
      inClass = false;
    } else if (char === '/' && !inClass) {
      return at + 1;
    } else if (char === '\n') {
      return at;
    }
  }
  return text.length;
}

/** 读一个引号字符串，返回内容和后面的位置。 */
function readQuoted(text: string, start: number): [string, number] {
  const quote = text[start];
  let content = '';
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at] ?? '';
    if (char === '\\') {
      content += text[at + 1] ?? '';
      at += 1;
    } else if (char === quote || char === '\n') {
      return [content, at + 1];
    } else {
      content += char;
    }
  }
  return [content, text.length];
}

/** 读一个模板字符串（${…} 记成 HOLE，里面嵌的字符串另外收进 out），返回内容和后面的位置。 */
function readTemplate(text: string, start: number, out: string[]): [string, number] {
  let content = '';
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at] ?? '';
    if (char === '\\') {
      content += text[at + 1] ?? '';
      at += 1;
    } else if (char === '`') {
      return [content, at + 1];
    } else if (char === '$' && text[at + 1] === '{') {
      content += HOLE;
      at = scanCode(text, at + 2, out, '}') - 1;
    } else {
      content += char;
    }
  }
  return [content, text.length];
}

/**
 * 从 start 扫代码到 until（嵌套的花括号配对），把字符串、模板和带汉字的 JSX 文字收进 out；注释跳过。
 * 返回停下的位置（until 之后）。
 */
function scanCode(text: string, start: number, out: string[], until: string | null): number {
  let depth = 0;
  let plain = '';
  const flush = (): void => {
    if (CJK.test(plain)) {
      out.push(plain);
    }
    plain = '';
  };
  for (let at = start; at < text.length;) {
    const char = text[at] ?? '';
    const next = text[at + 1] ?? '';
    if (char === '/' && next === '/') {
      flush();
      at = text.indexOf('\n', at) === -1 ? text.length : text.indexOf('\n', at);
    } else if (char === '/' && next === '*') {
      flush();
      at = text.indexOf('*/', at + 2) === -1 ? text.length : text.indexOf('*/', at + 2) + 2;
    } else if (char === '/' && /^$|[(,=:[!&|?{};+\-*%>~^]/.test(previousSignificant(text, at))) {
      flush();
      at = skipRegex(text, at);
    } else if (char === "'" || char === '"') {
      flush();
      const [content, after] = readQuoted(text, at);
      out.push(content);
      at = after;
    } else if (char === '`') {
      flush();
      const [content, after] = readTemplate(text, at, out);
      out.push(content);
      at = after;
    } else if (char === '{') {
      flush();
      depth += 1;
      at += 1;
    } else if (char === '}' && until === '}' && depth === 0) {
      flush();
      return at + 1;
    } else {
      if (char === '}') {
        depth -= 1;
      }
      plain = char === '\n' ? (flush(), '') : plain + char;
      at += 1;
    }
  }
  flush();
  return text.length;
}

export function uiTexts(source: string): string[] {
  const out: string[] = [];
  scanCode(source, 0, out, null);
  return out;
}
