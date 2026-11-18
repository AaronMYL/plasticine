// 假的笔记导入导出：照真服务的规矩做个大概，界面开发和测试够用——.md / .txt 才收，标题用第一行的标题或文件名，
// TXT 一行一段；一篇导出成 .md，多篇给一个包（假的包里只有文件名清单，不是真的 zip）。

import type { DownloadedFile } from '../client.ts';
import type { TransferFileInput } from '../shared.ts';
import type { NoteView } from '../types.ts';

function textOf(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes).replace(/\r\n?/g, '\n');
}

/** 一个文件导入成什么正文；不收就给原因。 */
export function fakeImportDraft(file: TransferFileInput): { markdown: string } | { reason: string } {
  const dot = file.name.lastIndexOf('.');
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!['md', 'markdown', 'txt'].includes(extension)) {
    return { reason: '不是 .md 或 .txt 文件' };
  }
  const text = textOf(file.contentBase64).trim();
  if (text === '') {
    return { reason: '文件是空的' };
  }
  if (extension === 'txt') {
    const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    return { markdown: `# ${base}\n\n${lines.join('\n\n')}` };
  }
  return { markdown: /^#{1,6}\s+\S/.test(text) ? text : `# ${base}\n\n${text}` };
}

export function fakeExportFile(notes: readonly NoteView[]): DownloadedFile {
  const first = notes[0];
  if (notes.length === 1 && first !== undefined) {
    return { name: `${first.title === '' ? '未命名' : first.title}.md`,
      blob: new Blob([first.markdown], { type: 'text/markdown' }) };
  }
  const listing = notes.map((note) => `${note.folder}/${note.title === '' ? '未命名' : note.title}.md`).join('\n');
  return { name: `Plasticine 笔记（${notes.length} 篇）.zip`, blob: new Blob([listing], { type: 'application/zip' }) };
}
