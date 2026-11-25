import type { ShellPrefsState } from '../state/shell-prefs.ts';
import type { ViewId } from './routes.ts';

export const SIDEBAR_AUTO_COLLAPSE_BELOW = 1280;
export const CHAT_AUTO_COLLAPSE_BELOW = 1280;
export const PHONE_BELOW = 768;

export type ChatPlacement = 'dialog' | 'ball' | 'hidden';

export interface ShellLayout {
  phone: boolean;
  sidebarCollapsed: boolean;
  chat: ChatPlacement;
}

export function computeLayout(width: number, prefs: ShellPrefsState, view: ViewId): ShellLayout {
  const phone = width < PHONE_BELOW;
  const sidebarCollapsed = prefs.sidebarCollapsed ?? width < SIDEBAR_AUTO_COLLAPSE_BELOW;
  let chat: ChatPlacement;
  if (view === 'conversation') {
    chat = 'hidden';
  } else if (phone) {
    chat = prefs.phoneChatOpen ? 'dialog' : 'ball';
  } else {
    chat = prefs.chatOpen ?? width >= CHAT_AUTO_COLLAPSE_BELOW ? 'dialog' : 'ball';
  }
  return { phone, sidebarCollapsed, chat };
}
