// CSS 一行一条声明（plasticine-code 底线 1）：`.a { color: red; margin: 0; }` 这种挤在一行的要展开。
// 只有一条声明的短规则可以留在一行（`.a { color: red; }`）。

/** 去掉注释、字符串和括号里的内容（url(data:…;…)、var(…) 里的分号和冒号不算）。保留换行，行号不变。 */
export function cssSkeleton(source: string): string {
  let out = '';
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += ' '.repeat(Math.min(j + 1, source.length) - i);
      i = j + 1;
    } else {
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1);
      }
      out += depth > 0 && ch !== '\n' && ch !== '(' ? ' ' : ch;
      i += 1;
    }
  }
  return out;
}

/** 这一行上有几条声明、几个 `{`。 */
export function cssLineLoad(line: string): { declarations: number; blocks: number } {
  const blocks = line.split('{').length - 1;
  let declarations = line.split(';').length - 1;
  // 最后一条声明可以不带分号：`{ color: red }`
  const close = line.lastIndexOf('}');
  if (close >= 0) {
    const tail = line.slice(Math.max(line.lastIndexOf(';', close), line.lastIndexOf('{', close)) + 1, close);
    if (tail.includes(':')) {
      declarations += 1;
    }
  }
  return { declarations, blocks };
}

/** 挤了不止一条声明、不止一个 `{`，或者花括号和声明挤在一行而规则又不止一行的行号（从 1 起）。 */
export function crowdedCssLines(source: string): number[] {
  const found: number[] = [];
  cssSkeleton(source).split('\n').forEach((line, index) => {
    const { declarations, blocks } = cssLineLoad(line);
    // 收尾的 `}` 前面还挤着声明：`  padding: 0; }`（这一行上没有它自己的 `{`）
    const trailing = blocks === 0 && /\S[^}]*\}/.test(line);
    // 开头的 `{` 后面跟着声明、这一行却没收尾：`.a { color: red;` 下一行接着写
    const leading = blocks === 1 && !line.includes('}') && /\{\s*\S/.test(line);
    if (declarations > 1 || blocks > 1 || trailing || leading) {
      found.push(index + 1);
    }
  });
  return found;
}
