import type { DownloadedFile } from '../client.ts';
import type { RenderPageRequest, TransferFileInput } from '../shared.ts';

const EXTENSIONS = new Set(['md', 'markdown', 'txt', 'html', 'htm', 'docx']);

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function fakeSpaceDraft(file: TransferFileInput): { title: string; html: string } | { reason: string } {
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!EXTENSIONS.has(extension)) return { reason: '只收 Markdown、TXT、Word（.docx）和网页文件' };
  const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
  const text = extension === 'docx' ? base : new TextDecoder().decode(bytes).replace(/<[^>]+>/g, ' ').trim();
  if (text === '') return { reason: '文件里没有内容' };
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const heading = /^#\s+(.+)$/.exec(lines[0] ?? '')?.[1];
  const title = heading ?? base;
  const body = (heading === undefined ? lines : lines.slice(1)).map((line) => `<p>${escape(line)}</p>`).join('');
  return { title, html: `<header class="rp-hero"><h1 class="rp-h1">${escape(title)}</h1></header>`
    + `<section class="rp-sec" id="s1">${body}</section>` };
}

export function fakeSpaceFile(titles: readonly string[], format: 'markdown' | 'docx'): DownloadedFile {
  const extension = format === 'docx' ? 'docx' : 'md';
  const first = titles[0];
  const name = titles.length === 1 && first !== undefined ? `${first}.${extension}`
    : `Plasticine 资料库（${titles.length} 篇）.zip`;
  return { name, blob: new Blob([titles.join('\n')]) };
}

export function fakeRendered(input: RenderPageRequest): DownloadedFile {
  return { name: `${input.name}.${input.format}`, blob: new Blob([input.format === 'pdf' ? '%PDF' : 'png']) };
}
