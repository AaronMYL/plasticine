// 壳的偏好：侧栏收起与否、对话框展开与否、对话框的位置和大小、手机上对话开没开、「问这一页」开没开。
// null / 没记过 表示没手动选过，跟着窗口宽度自动（窄于 1280 侧栏收成图标条、对话框收成圆球；views.md「三栏壳」）。
// 设计稿 2026-11-03：右侧对话栏改成悬浮在整个页面最上层的对话框，缩小是右下角圆球，展开是右下角约 420×640 的浮窗，
// 可拖动、可调大小，记住位置和大小（存的是离右边、下边多远，窗口变大变小它都还贴着右下角）。

import { Store } from './store.ts';
import type { KeyValueStorage } from './outbox.ts';

export interface ChatFrame {
  width: number;
  height: number;
  /** 离窗口右边多远。 */
  right: number;
  /** 离窗口下边多远。 */
  bottom: number;
}

/** 对话框默认 420×640，离右、下各 24（方向 I 的间距档）。 */
export const CHAT_FRAME_DEFAULT: ChatFrame = { width: 420, height: 640, right: 24, bottom: 24 };
/** 最小 340×420：放得下一张工具卡和输入框；最大 720 宽，高到窗口上下各留 16。 */
export const CHAT_MIN_WIDTH = 340;
export const CHAT_MIN_HEIGHT = 420;
export const CHAT_MAX_WIDTH = 720;
/** 拖到边上时至少留在窗口里这么多（能抓回来）。 */
const EDGE = 16;

export interface ShellPrefsState {
  sidebarCollapsed: boolean | null;
  /** 对话框展开（true）还是缩成圆球（false）；没选过跟窗口宽度走。 */
  chatOpen: boolean | null;
  chatFrame: ChatFrame;
  phoneChatOpen: boolean;
  /** 电脑上联系人的资料栏开着没有（聊天头最右的按钮开关，记住；第 113 条）。默认开着。 */
  contactProfile: boolean;
  /**
   * 对话框输入框里「问这一页」开着没有（2026-11-04 第 2 批，用户定：开着 = 发出去的话带上当前标签这一页，切标签跟着走，
   * 记住上次的开关）。默认关着：不开就不带，Plasticine 不自己读你开着的页面。
   */
  askPage: boolean;
  /**
   * 第二栏收起来的栏目（11-08 他定「第二级能收起」）：按栏目各记各的——网页收成一条窄栏是为了看网页时宽一点，
   * 笔记、消息的列表照样要用，不该跟着一起收。
   */
  collapsedColumns: readonly string[];
}

/** 把对话框放回窗口里：大小在上下限之间，整个框都在窗口里（离边至少 16）。 */
export function clampChatFrame(frame: ChatFrame, viewport: { width: number; height: number }): ChatFrame {
  const maxWidth = Math.max(CHAT_MIN_WIDTH, Math.min(CHAT_MAX_WIDTH, viewport.width - EDGE * 2));
  const maxHeight = Math.max(CHAT_MIN_HEIGHT, viewport.height - EDGE * 2);
  const width = Math.round(Math.min(maxWidth, Math.max(CHAT_MIN_WIDTH, frame.width)));
  const height = Math.round(Math.min(maxHeight, Math.max(CHAT_MIN_HEIGHT, frame.height)));
  const right = Math.round(Math.min(Math.max(EDGE, viewport.width - width - EDGE), Math.max(EDGE, frame.right)));
  const bottom = Math.round(Math.min(Math.max(EDGE, viewport.height - height - EDGE), Math.max(EDGE, frame.bottom)));
  return { width, height, right, bottom };
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
  return { width: width!, height: height!, right: right!, bottom: bottom! };
}

export class ShellPrefs {
  readonly store: Store<ShellPrefsState>;
  constructor(storage: KeyValueStorage | null = null) {
    const initial: ShellPrefsState = { sidebarCollapsed: null, chatOpen: null, chatFrame: CHAT_FRAME_DEFAULT,
      phoneChatOpen: false, contactProfile: true, askPage: false, collapsedColumns: [] };
    try {
      const saved: unknown = JSON.parse(storage?.getItem('plasticine:shell-prefs') ?? 'null');
      if (saved !== null && typeof saved === 'object') {
        if ('sidebarCollapsed' in saved && typeof saved.sidebarCollapsed === 'boolean') {
          initial.sidebarCollapsed = saved.sidebarCollapsed;
        }
        // 旧版的对话栏按视图收起、宽度都是右侧整高栏的事，悬浮对话框不沿用：从默认开始，下次保存就不再写它们。
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

  setContactProfile(open: boolean): void {
    this.store.set((state) => ({ ...state, contactProfile: open }));
  }

  /** 某个栏目的第二栏收起 / 展开。 */
  setColumnCollapsed(section: string, collapsed: boolean): void {
    this.store.set((state) => {
      const rest = state.collapsedColumns.filter((id) => id !== section);
      if (!collapsed && rest.length === state.collapsedColumns.length) return state;
      if (collapsed && rest.length !== state.collapsedColumns.length) return state;
      return { ...state, collapsedColumns: collapsed ? [...rest, section] : rest };
    });
  }

  setAskPage(on: boolean): void {
    this.store.set((state) => ({ ...state, askPage: on }));
  }
}
