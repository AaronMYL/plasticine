import type { Quote } from '../api/types.ts';
import { Store } from './store.ts';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { QuoteSchema, type KeyValueStorage } from './outbox.ts';

const REFRESH_DRAFT_KEY = 'plasticine.conversation-refresh-draft';
const DraftSchema = Type.Object({ draft: Type.String(), quotes: Type.Array(QuoteSchema) });

export interface ConversationScroll {
  atBottom: boolean;
  scrollTop: number;
}

export interface ReplyDraft {
  seq: number;
  author: string;
  text: string;
}

export interface ConversationUiState {
  draft: string;
  quotes: Quote[];
  scroll: ConversationScroll;
  reply: ReplyDraft | null;
}

export function mergeDraft(current: string, restored: string): string {
  if (current.trim() === '') {
    return restored;
  }
  if (restored.trim() === '') {
    return current;
  }
  return `${current.trimEnd()}\n\n${restored}`;
}

const INITIAL: ConversationUiState = {
  draft: '',
  quotes: [],
  scroll: { atBottom: true, scrollTop: 0 },
  reply: null,
};

export class ConversationUi {
  readonly store = new Store<ConversationUiState>(INITIAL);
  private readonly storage: KeyValueStorage | null;
  private saved: string | null = null;

  constructor(storage: KeyValueStorage | null = null) {
    this.storage = storage;
    try {
      const raw = storage?.getItem(REFRESH_DRAFT_KEY);
      const parsed: unknown = raw == null ? null : JSON.parse(raw);
      if (Value.Check(DraftSchema, parsed)) {
        this.store.set({ ...INITIAL, ...parsed });
        this.saved = JSON.stringify(parsed);
      }
    } catch {
      console.warn('刷新前的对话草稿没读到，请检查浏览器存储。');
    }
    this.store.subscribe(() => {
      if (this.saved !== null && this.saved !== this.draftText()) {
        this.saved = null;
        try {
          storage?.removeItem(REFRESH_DRAFT_KEY);
        } catch {
          console.warn('旧的对话草稿未能清理，请检查浏览器存储。');
        }
      }
    });
  }

  private draftText(): string {
    const { draft, quotes } = this.store.get();
    return JSON.stringify({ draft, quotes });
  }

  savedForRefresh(): boolean {
    return this.saved !== null && this.saved === this.draftText();
  }

  saveForRefresh(): void {
    const { draft, quotes } = this.store.get();
    if (draft === '' && quotes.length === 0) {
      return;
    }
    const text = this.draftText();
    this.storage?.setItem(REFRESH_DRAFT_KEY, text);
    if (this.storage?.getItem(REFRESH_DRAFT_KEY) !== text) {
      throw new Error('对话草稿未保存，请检查浏览器存储后重试');
    }
    this.saved = text;
  }

  setDraft(draft: string): void {
    this.store.set((state) => ({ ...state, draft }));
  }

  addQuote(quote: Quote): void {
    this.store.set((state) => {
      if (state.quotes.some((existing) => existing.id === quote.id)) {
        return state;
      }
      return { ...state, quotes: [...state.quotes, quote] };
    });
  }

  removeQuote(id: string): void {
    this.store.set((state) => ({ ...state, quotes: state.quotes.filter((quote) => quote.id !== id) }));
  }

  clearComposer(): void {
    this.store.set((state) => ({ ...state, draft: '', quotes: [], reply: null }));
  }

  setReply(reply: ReplyDraft | null): void {
    this.store.set((state) => ({ ...state, reply }));
  }

  restoreToComposer(text: string, quotes: readonly Quote[]): void {
    this.store.set((state) => {
      const known = new Set(state.quotes.map((quote) => quote.id));
      const added = quotes.filter((quote) => !known.has(quote.id));
      return { ...state, draft: mergeDraft(state.draft, text), quotes: [...state.quotes, ...added] };
    });
  }

  saveScroll(scroll: ConversationScroll): void {
    this.store.set((state) => {
      const same = state.scroll.atBottom === scroll.atBottom && state.scroll.scrollTop === scroll.scrollTop;
      return same ? state : { ...state, scroll };
    });
  }
}
