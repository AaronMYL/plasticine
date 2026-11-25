const HEADING_MAX_CHARS = 30;

export interface ReaderBlock {
  kind: 'paragraph' | 'heading';
  text: string;
}

export function readerBlocks(text: string, title = ''): ReaderBlock[] {
  const all = text.split(/\n+/).map((line) => line.trim()).filter((line) => line !== '');
  const titleAt = title.trim() === '' ? -1 : all.indexOf(title.trim());
  const lines = titleAt < 0 ? all : all.slice(titleAt + 1);
  const unique = lines.filter((line, index) => lines[index - 1] !== line);
  return unique.map((line, index) => {
    const next = unique[index + 1];
    const heading = Array.from(line).length <= HEADING_MAX_CHARS && !/[。！？.!?；;，,：:]$/.test(line)
      && next !== undefined && (Array.from(next).length > HEADING_MAX_CHARS || /[。！？.!?]$/.test(next));
    return { kind: heading ? 'heading' : 'paragraph', text: line };
  });
}
