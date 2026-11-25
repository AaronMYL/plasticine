import { Store } from './store.ts';
import type { KeyValueStorage } from './outbox.ts';

export interface ChatFrame {
  width: number;
  height: number;
  right: number;
  bottom: number;
  full: boolean;
}

export const CHAT_FRAME_DEFAULT: ChatFrame = { width: 420, height: 640, right: 24, bottom: 24, full: true };
export const CHAT_MIN_WIDTH = 340;
export const CHAT_MIN_HEIGHT = 420;
export const CHAT_MAX_WIDTH = 720;
const EDGE = 16;

export interface ShellPrefsState {
  sidebarCollapsed: boolean | null;
  chatOpen: boolean | null;
  chatFrame: ChatFrame;
  phoneChatOpen: boolean;
  contactProfile: boolean;
  askPage: boolean;
  collapsedColumns: readonly string[];
  bookmarksCollapsed: boolean;
  composePredict: boolean;
}

export function clampChatFrame(frame: ChatFrame, viewport: { width: number; height: number }): ChatFrame {
  const maxWidth = Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, viewport.width - EDGE * 2));
  const maxHeight = Math.max(CHAT_MIN_HEIGHT, viewport.height - EDGE * 2);
  const width = Math.round(Math.min(maxWidth, Math.max(CHAT_MIN_WIDTH, frame.width)));
  const height = Math.round(Math.min(maxHeight, Math.max(CHAT_MIN_HEIGHT, frame.height)));
  const right = Math.round(Math.min(Math.max(EDGE, viewport.width - width - EDGE), Math.max(EDGE, frame.right)));
  const bottom = Math.round(Math.min(Math.max(EDGE, viewport.height - height - EDGE), Math.max(EDGE, frame.bottom)));
  return { width, height, right, bottom, full: frame.full };
}

function readFrame(saved: unknown): ChatFrame | null {
  if (saved === null || typeof saved !== 'object') {
    return null;
  }
  const values = ['width', 'height', 'right', 'bottom'].map((key) => (saved as Record<string, unknown>)[key]);
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return null;
  }
  const [width, height, right, bottom] = values as number[];
  const full = (saved as Record<string, unknown>)['full'];
  return { width: width!, height: height!, right: right!, bottom: bottom!, full: typeof full === 'boolean' ? full
    : true };
}

export class ShellPrefs {
  readonly store: Store<ShellPrefsState>;
  constructor(storage: KeyValueStorage | null = null) {
    const initial: ShellPrefsState = { sidebarCollapsed: null, chatOpen: null, chatFrame: CHAT_FRAME_DEFAULT,
      phoneChatOpen: false, contactProfile: true, askPage: false, collapsedColumns: [], bookmarksCollapsed: false,
      composePredict: true };
    try {
      const saved: unknown = JSON.parse(storage?.getItem('plasticine:shell-prefs') ?? 'null');
      if (saved !== null && typeof saved === 'object') {
        if ('sidebarCollapsed' in saved && typeof saved.sidebarCollapsed === 'boolean') {
          initial.sidebarCollapsed = saved.sidebarCollapsed;
        }
        if ('chatOpen' in saved && typeof saved.chatOpen === 'boolean') {
          initial.chatOpen = saved.chatOpen;
        }
        if ('chatFrame' in saved) {
          initial.chatFrame = readFrame(saved.chatFrame) ?? CHAT_FRAME_DEFAULT;
        }
        if ('contactProfile' in saved && typeof saved.contactProfile === 'boolean') {
          initial.contactProfile = saved.contactProfile;
        }
        if ('askPage' in saved && typeof saved.askPage === 'boolean') {
          initial.askPage = saved.askPage;
        }
        if ('collapsedColumns' in saved && Array.isArray(saved.collapsedColumns)) {
          initial.collapsedColumns = saved.collapsedColumns.filter((id): id is string => typeof id === 'string');
        }
        if ('bookmarksCollapsed' in saved && typeof saved.bookmarksCollapsed === 'boolean') {
          initial.bookmarksCollapsed = saved.bookmarksCollapsed;
        }
        if ('composePredict' in saved && typeof saved.composePredict === 'boolean') {
          initial.composePredict = saved.composePredict;
        }
      }
    } catch (cause) {
      console.warn('布局偏好未能恢复，将使用默认布局。', cause);
    }
    this.store = new Store(initial);
    this.store.subscribe(() => {
      const { phoneChatOpen: _temporary, ...saved } = this.store.get();
      try {
        storage?.setItem('plasticine:shell-prefs', JSON.stringify(saved));
      } catch (cause) {
        console.warn('布局偏好未能保存，当前操作不受影响。', cause);
      }
    });
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.store.set((state) => ({ ...state, sidebarCollapsed: collapsed }));
  }

  setChatOpen(open: boolean): void {
    this.store.set((state) => ({ ...state, chatOpen: open }));
  }

  setChatFrame(frame: ChatFrame): void {
    this.store.set((state) => ({ ...state, chatFrame: frame }));
  }

  setPhoneChatOpen(open: boolean): void {
    this.store.set((state) => ({ ...state, phoneChatOpen: open }));
  }

  setComposePredict(on: boolean): void {
    this.store.set((state) => ({ ...state, composePredict: on }));
  }

  setContactProfile(open: boolean): void {
    this.store.set((state) => ({ ...state, contactProfile: open }));
  }

  setColumnCollapsed(section: string, collapsed: boolean): void {
    this.store.set((state) => {
      const rest = state.collapsedColumns.filter((id) => id !== section);
      if (!collapsed && rest.length === state.collapsedColumns.length) return state;
      if (collapsed && rest.length !== state.collapsedColumns.length) return state;
      return { ...state, collapsedColumns: collapsed ? [...rest, section] : rest };
    });
  }

  setBookmarksCollapsed(collapsed: boolean): void {
    this.store.set((state) => ({ ...state, bookmarksCollapsed: collapsed }));
  }

  setAskPage(on: boolean): void {
    this.store.set((state) => ({ ...state, askPage: on }));
  }
}
