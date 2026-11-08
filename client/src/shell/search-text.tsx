import type { ReactNode } from 'react';

export function searchExcerpt(text: string, query: string, length = 140): string {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index - Math.floor(length / 3));
  const end = Math.min(text.length, Math.max(start + length, index + query.length));
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export function SearchHighlight({ text, query }: { text: string; query: string }): ReactNode {
  if (query === '') return text;
  const output: ReactNode[] = [];
  const lower = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  let from = 0;
  let index = lower.indexOf(needle);
  while (index >= 0) {
    output.push(text.slice(from, index), <mark key={index}>{text.slice(index, index + query.length)}</mark>);
    from = index + query.length;
    index = lower.indexOf(needle, from);
  }
  output.push(text.slice(from));
  return <>{output}</>;
}
