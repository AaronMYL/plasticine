import { expect, it, vi } from 'vitest';
import { HttpNotes } from '../../src/api/http/notes.ts';
import { LocalEvents } from '../../src/api/http/local-events.ts';
import { dispositionFileName, Transport } from '../../src/api/http/transport.ts';
import { noteView } from './http-fixtures.ts';

it('Content-Disposition filename decodes UTF-8 and quoted names, returning null if missing/bad', () => {
  expect(dispositionFileName(`attachment; filename*=UTF-8''${encodeURIComponent('周末 计划.md')}`)).toBe('周末 计划.md');
  expect(dispositionFileName('attachment; filename="notes.zip"')).toBe('notes.zip');
  expect(dispositionFileName("attachment; filename*=UTF-8''%E0%A4%A")).toBeNull();
  expect(dispositionFileName(null)).toBeNull();
});

it('export notes sends ids, returns bytes and server filename, and classifies server errors', async () => {
  const blob = new Blob(['# 计划'], { type: 'text/markdown' });
  const header = `attachment; filename*=UTF-8''${encodeURIComponent('计划.md')}`;
  const fetch = vi.fn(async () => ({ status: 200, text: async () => '', blob: async () => blob,
    headers: { get: (name: string) => (name === 'content-disposition' ? header : null) } }));
  const notes = new HttpNotes(new Transport({ fetch, onUnauthorized: vi.fn() }), new LocalEvents());
  expect(await notes.exportFiles(['n1', 'n2'])).toEqual({ blob, name: '计划.md' });
  expect(fetch).toHaveBeenCalledWith('/v2/notes/export', expect.objectContaining({ method: 'POST',
    body: JSON.stringify({ ids: ['n1', 'n2'] }) }));
  const missing = vi.fn(async () => ({ status: 404, blob: async () => blob,
    text: async () => JSON.stringify({ code: 'not_found', error: '没有这篇笔记。' }) }));
  const failing = new HttpNotes(new Transport({ fetch: missing, onUnauthorized: vi.fn() }), new LocalEvents());
  await expect(failing.exportFiles(['gone'])).rejects.toMatchObject({ kind: 'not_found', message: '没有这篇笔记。' });
});

it('import notes validates response schema and notifies list for every imported note', async () => {
  const note = noteView({ id: 'note_new', title: '第一篇' });
  const { markdown: _markdown, ...meta } = note;
  const fetch = vi.fn(async () => ({ status: 200, text: async () => JSON.stringify({ imported: [meta],
    skipped: [{ name: '表格.csv', reason: '不是 .md 或 .txt 文件' }] }) }));
  const local = new LocalEvents();
  const seen: string[] = [];
  local.on((event) => { if (event.type === 'note.updated') seen.push(event.note.id); });
  const notes = new HttpNotes(new Transport({ fetch, onUnauthorized: vi.fn() }), local);
  const result = await notes.importFiles({ requestId: 'req_import', files: [{ name: 'a.md', contentBase64: 'IyBh' }] });
  expect(result.imported.map((row) => row.title)).toEqual(['第一篇']);
  expect(result.skipped).toEqual([{ name: '表格.csv', reason: '不是 .md 或 .txt 文件' }]);
  expect(seen).toEqual(['note_new']);
});
