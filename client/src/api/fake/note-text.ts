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

export function noteBytes(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}
