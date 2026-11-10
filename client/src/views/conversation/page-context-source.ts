// 当前页的真实来源：笔记沿用共享缓存和版本引用，不把未保存草稿或读取失败当成正文。
import type { PlasticineApi } from '../../api/client.ts';
import type { ClientState } from '../../state/context.tsx';
import type { CurrentTab } from '../../shell/current-tab-context.ts';
import { buildNoteQuote } from '../notes/note-quote.ts';
import { currentPageQuote, type PageQuoteResult } from './ask-this-page.tsx';
import { currentPageReference } from './current-page-reference.ts';

export async function readPageContext(tab: CurrentTab, contactText: string | null, budget: number,
  api: PlasticineApi, state: ClientState, force = false): Promise<PageQuoteResult> {
  const noteId = tab.route?.view === 'notes' ? tab.route.noteId : null;
  if (noteId === null) {
    if (tab.route?.spaceId != null || tab.route?.bookId != null) {
      const quote = await currentPageReference(tab, api);
      if (quote !== null) return { quote, title: quote.label, scope: '当前版本', failed: false };
    }
    return currentPageQuote(tab, contactText, budget);
  }
  if (state.noteDrafts.get(noteId) !== undefined) {
    throw new Error('这篇笔记还有未保存的修改，保存后重试。');
  }
  await state.notesCache.loadNote(api.notes, noteId, force);
  const cached = state.notesCache.store.get().get(noteId);
  if (cached?.error != null) {
    throw new Error(cached.error);
  }
  const note = cached?.note;
  if (note == null) {
    throw new Error('没读到这篇笔记，请重试。');
  }
  if (state.noteDrafts.get(noteId) !== undefined) {
    throw new Error('这篇笔记还有未保存的修改，保存后重试。');
  }
  const chars = Array.from(note.markdown);
  const truncated = chars.length > budget;
  const quote = buildNoteQuote(note, truncated
    ? { selection: chars.slice(0, budget).join(''), selectionKey: `page-first-${budget}` } : {});
  const scope = truncated ? `正文前 ${budget.toLocaleString('zh-CN')} 字` : '已保存全文';
  return { quote, failed: false, title: note.title || '未命名',
    scope: `${scope} · 版本 ${note.version}` };
}
