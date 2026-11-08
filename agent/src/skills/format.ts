import { SKILL_NAME_PATTERN } from '../../shared/skills.ts';

/** Required Agent Skills YAML fields are strings; optional metadata stays in the original document. */
export function skillMetadata(document: string, directoryName: string): { name: string; description: string } {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(document.replace(/^\uFEFF/, ''));
  if (matched === null) { throw new Error('SKILL.md 缺少 YAML frontmatter。'); }
  const lines = matched[1]!.split(/\r?\n/);
  const values = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const field = /^(name|description):\s*(.*)$/.exec(lines[index]!);
    if (field === null) { continue; }
    if (values.has(field[1]!)) { throw new Error(`SKILL.md 重复定义 ${field[1]}。`); }
    let text = field[2]!.trim();
    if (/^[>|][-+]?\s*(?:#.*)?$/.test(text)) {
      const folded = text.startsWith('>');
      const body: string[] = [];
      while (index + 1 < lines.length && (/^\s/.test(lines[index + 1]!) || lines[index + 1] === '')) {
        index += 1;
        body.push(lines[index]!.trim());
      }
      text = body.join(folded ? ' ' : '\n').trim();
    } else if (text.startsWith('"')) {
      const quoted = /^"(?:[^"\\]|\\.)*"/.exec(text)?.[0];
      if (quoted === undefined) { throw new Error('SKILL.md 字符串引号没有闭合。'); }
      text = JSON.parse(quoted) as string;
    } else if (text.startsWith("'")) {
      const quoted = /^'((?:[^']|'')*)'/.exec(text);
      if (quoted === null) { throw new Error('SKILL.md 字符串引号没有闭合。'); }
      text = quoted[1]!.replaceAll("''", "'");
    } else {
      text = text.replace(/\s+#.*$/, '').trim();
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1]!)) {
        index += 1;
        text += ` ${lines[index]!.trim()}`;
      }
    }
    values.set(field[1]!, text);
  }
  const name = values.get('name') ?? '';
  const description = values.get('description') ?? '';
  if (!new RegExp(SKILL_NAME_PATTERN).test(name) || name.length > 64 || name !== directoryName) {
    throw new Error('Skill name 必须与目录一致，使用 1–64 位小写字母、数字与单个连字符。');
  }
  if (description.length < 1 || description.length > 1_024 || document.length > 64_000) {
    throw new Error('Skill description 要是 1–1024 字符，SKILL.md 不超过 64000 字符。');
  }
  return { name, description };
}

export function skillPath(path: string): string {
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/')
    || path.split('/').some((part) => part === '..' || part === '.' || part === '' || part.startsWith('.'))) {
    throw new Error('Skill 资源路径必须在技能目录内，不能带隐藏路径或父目录跳转。');
  }
  return path;
}
