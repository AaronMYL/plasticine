import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { buildNoteQuote } from '../../../src/views/notes/note-quote.ts';
import { Outbox } from '../../../src/state/outbox.ts';
import { memoryStorage, seedNote } from '../../helpers.tsx';

async function savedNote(markdown: string, privateNote = false) {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  seedNote(fake, 'note_quote', markdown, { version: 7, private: privateNote });
  return fake.api.notes.get('note_quote');
}

describe('笔记引用范围', () => {
  it('全文保留实际正文并绑定笔记版本，选段超过六百字仍全部保留', async () => {
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

  it('私密或超出引用容量的笔记清楚报错，不降级为六百字摘要', async () => {
    const privateNote = await savedNote('私密', true);
    expect(() => buildNoteQuote(privateNote)).toThrow(/私密/);
    const large = await savedNote('字'.repeat(120_001));
    expect(() => buildNoteQuote(large)).toThrow(/选段|拆分/);
  });

  it('新引用与旧待发引用在刷新后一起恢复，精确版本和全部选段不丢失', async () => {
    const quote = buildNoteQuote(await savedNote('# 内容\n正文'));
    const legacy = { id: 'legacy', kind: 'note' as const, sourceId: 'old', label: '旧引用', text: '过去的摘要' };
    const storage = memoryStorage();
    const outbox = new Outbox(storage);
    outbox.add({ requestId: 'request-quote', text: '继续', quotes: [quote, legacy], status: 'failed', error: '断线' });
    expect(new Outbox(storage).find('request-quote')?.quotes).toEqual([quote, legacy]);
  });
});
