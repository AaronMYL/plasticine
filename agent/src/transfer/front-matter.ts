// Markdown 开头的属性块（两道 --- 之间，Obsidian 等叫 front matter）：导出时写创建和修改时间，导入时读回来。
// 只认顶格的「键: 值」这种写法里的三项（title、created、updated）；别的行原样交回，由导入的一方决定怎么留。
// 两道线之间有不像属性的行（一段话）就不当属性块：那是正文里的分隔线。

const KNOWN = new Set(['title', 'created', 'updated']);
const KEY_LINE = /^([A-Za-z_][\w-]*):(?:\s+(.*)|\s*)$/;
/** 属性块里合法的别的行：缩进的续行、列表项、注释、空行。 */
const OTHER_LINE = /^(\s+\S.*|-\s.*|#.*|\s*)$/;

export interface FrontMatter {
  /** 认得的几项：小写的键 → 去掉引号的值。 */
  fields: ReadonlyMap<string, string>;
  /** 没认出来的行，原样。 */
  rest: string[];
  /** 属性块后面的正文。 */
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : quoted[2] ?? '';
}

/** 开头有属性块就拆开；没有是 null。 */
export function splitFrontMatter(text: string): FrontMatter | null {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') {
    return null;
  }
  const end = lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'));
  if (end < 0) {
    return null;
  }
  const fields = new Map<string, string>();
  const rest: string[] = [];
  let keys = 0;
  for (const line of lines.slice(1, end)) {
    const match = KEY_LINE.exec(line);
    if (match === null && !OTHER_LINE.test(line)) {
      return null;
    }
    const key = match?.[1]?.toLowerCase();
    const value = match?.[2];
    keys += match === null ? 0 : 1;
    if (key !== undefined && KNOWN.has(key) && value !== undefined && value.trim() !== '' && !fields.has(key)) {
      fields.set(key, unquote(value));
    } else if (line.trim() !== '') {
      rest.push(line);
    }
  }
  if (keys === 0) {
    return null;
  }
  return { fields, rest, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

/** 写一段属性块（后面空一行）。值都是时间这类不用加引号的字。 */
export function frontMatterBlock(fields: Readonly<Record<string, string>>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}
