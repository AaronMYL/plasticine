// 浅色字建议的共同规则（11-13 Aaron：笔记续写「和输入建议对齐」）：笔记续写和对话、消息里的输入建议用同一套。
// - 停手 PREDICT_PAUSE_MS 才猜；光标在这一段 / 这个框的末尾、没选中、聚焦着才出。
// - 中文输入法组词期间不出、不猜（imeBusy）；组完词按一次新输入算。
// - 有建议时 Tab 采纳、Esc 收起；没建议时两个键照原来的用法。
// - 预测闭环：采纳算收下；Esc 算没要；摆了 MIN_VISIBLE_MS 以上被打字盖掉也算没要；一闪而过的不报。

/** 停手这么久才猜（笔记续写 2026-11-09 起是 0.4 秒，输入建议照这个）。 */
export const PREDICT_PAUSE_MS = 400;
/** 摆出来不到这么久就撤下的不算「没要」：他多半没看见。 */
export const MIN_VISIBLE_MS = 1500;
/** 输入法组词时浏览器给的 keyCode。 */
const IME_KEY_CODE = 229;

/** 这一下按键是输入法组词里的（选候选、确认拼音），不能当成 Tab / Esc / Enter。 */
export function imeBusy(event: { isComposing?: boolean; keyCode?: number }, composing = false): boolean {
  return composing || event.isComposing === true || event.keyCode === IME_KEY_CODE;
}
