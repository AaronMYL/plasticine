// 从正文推出标题和预览：第一行非空文字是标题（去掉 Markdown 的井号），其余的开头是预览。
// 真服务端也是这么做的（旧版 agent/src/notes.ts）；假实现照做，列表才像真的。

/** 列表预览取正文开头这么多字，和旧版列表一致。 */
const PREVIEW_CHARS = 80;

function plainLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '［图］')
    .replace(/[*_`~]/g, '')
    .trim();
}

export function noteTitle(markdown: string): string {
  for (const line of markdown.split('\n')) {
    const text = plainLine(line);
    if (text !== '') {
      return text;
    }
  }
  return '';
}

export function notePreview(markdown: string): string {
  const lines = markdown
    .split('\n')
    .map(plainLine)
    .filter((line) => line !== '');
  return Array.from(lines.slice(1).join(' ')).slice(0, PREVIEW_CHARS).join('');
}

/** 正文的 UTF-8 字节数：服务端 NoteMetaView.bytes 就是这个。 */
export function noteBytes(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}
