import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..');
export const SCANNED = [join(ROOT, 'client', 'src'), join(ROOT, 'agent', 'shared')];
const SKIPPED = [/\.test\.tsx?$/, /[\\/]fake[\\/]/];
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

function previousSignificant(text: string, index: number): string {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (!/\s/.test(text[at] ?? '')) {
      return text[at] ?? '';
    }
  }
  return '';
}

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
