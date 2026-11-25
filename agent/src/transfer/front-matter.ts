const KNOWN = new Set(['title', 'created', 'updated']);
const KEY_LINE = /^([A-Za-z_][\w-]*):(?:\s+(.*)|\s*)$/;
const OTHER_LINE = /^(\s+\S.*|-\s.*|#.*|\s*)$/;

export interface FrontMatter {
  fields: ReadonlyMap<string, string>;
  rest: string[];
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : quoted[2] ?? '';
}

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

export function frontMatterBlock(fields: Readonly<Record<string, string>>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}
