// 壳怎么折：按窗口宽度和你手动选过的偏好算出侧栏和对话框的样子（views.md「三栏壳」，设计稿 2026-11-03 改成悬浮对话框）。

import type { ShellPrefsState } from '../state/shell-prefs.ts';
import type { ViewId } from './routes.ts';

/** 窄于 1280 侧栏自动收成 64px 图标栏；对话框没选过时也默认缩成圆球（窗口窄了浮窗会盖住太多页面）。 */
export const SIDEBAR_AUTO_COLLAPSE_BELOW = 1280;
export const CHAT_AUTO_COLLAPSE_BELOW = 1280;
/** 窄于 768 是手机排法：底部标签栏，对话展开是全屏（默认值，四个截图尺寸里 768 算平板）。 */
export const PHONE_BELOW = 768;
/**
 * 宽到 1280 起，展开的对话停靠成右边一栏（11-12 全量优化，Aaron 定「对话栏停靠」）：页面让出位置，不再被浮窗盖住；
 * 窄于 1280 的电脑窗口还是浮窗（停靠会把页面挤得太窄）。
 */
export const CHAT_DOCK_FROM = 1280;

/**
 * dialog：悬浮对话框展开（电脑是右下角浮窗，手机是全屏）。ball：缩成右下角圆球。
 * hidden：在对话整页上，那页本身就是对话，不显示圆球。
 */
export type ChatPlacement = 'dialog' | 'ball' | 'hidden';

export interface ShellLayout {
  phone: boolean;
  sidebarCollapsed: boolean;
  chat: ChatPlacement;
  /** 展开的对话是不是停靠在右边（只有 chat 是 dialog 时有意义）。 */
  chatDocked: boolean;
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
  return { phone, sidebarCollapsed, chat, chatDocked: !phone && chat === 'dialog' && width >= CHAT_DOCK_FROM };
}
