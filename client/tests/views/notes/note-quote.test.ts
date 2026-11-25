import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { buildNoteQuote } from '../../../src/views/notes/note-quote.ts';
import { Outbox } from '../../../src/state/outbox.ts';
import { memoryStorage, seedNote } from '../../helpers.tsx';

async function savedNote(markdown: string) {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  seedNote(fake, 'note_quote', markdown, { version: 7 });
  return fake.api.notes.get('note_quote');
}

describe('Note quote scope', () => {
  it('full quote keeps actual body with note version; selections over 600 chars stay intact', async () => {
    const markdown = `# 标题\n${'全文'.repeat(500)}\n结尾`;
    const note = await savedNote(markdown);
    const quote = buildNoteQuote(note);
    expect(quote.text).toBe(markdown);
    expect(quote.noteReference).toEqual({ noteId: note.id, version: 7, scope: 'full' });
    const selection = `${'😀'.repeat(700)}最后`;
    const excerpt = buildNoteQuote(note, { selection, selectionKey: '2_705' });
    expect(excerpt.text).toBe(selection);
    expect(excerpt.noteReference).toEqual({ noteId: note.id, version: 7, scope: 'selection', text: selection });
    expect(excerpt.id).not.toBe(quote.id);
  });

  it('reports clear error when note exceeds quote limit instead of degrading to 600-char summary', async () => {
    const large = await savedNote('字'.repeat(120_001));
    expect(() => buildNoteQuote(large)).toThrow(/选段|拆分/);
  });

  it('restores new and pending quotes after refresh without losing exact version or selection', async () => {
    const quote = buildNoteQuote(await savedNote('# 内容\n正文'));
    const legacy = { id: 'legacy', kind: 'note' as const, sourceId: 'old', label: '旧引用', text: '过去的摘要' };
    const storage = memoryStorage();
    const outbox = new Outbox(storage);
    outbox.add({ requestId: 'request-quote', text: '继续', quotes: [quote, legacy], status: 'failed', error: '断线' });
    expect(new Outbox(storage).find('request-quote')?.quotes).toEqual([quote, legacy]);
  });
});
