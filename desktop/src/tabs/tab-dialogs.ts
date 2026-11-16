// 网页弹框（11-16 能力总表「页面弹出的对话框」）：后台标签里 alert / confirm / prompt 会弹系统框、抢到他眼前，页面还卡着
// 等人点。preload 往页面自己的脚本世界装一层：标签没给他看（document.visibilityState 是 hidden）时不弹，按预先说好的答
// （tab_dialog）或者默认答（提示点「好」、确认点「取消」、输入框不填），把弹了什么记下来给 Plasticine 看；他正看着的标签
// 照常弹。两个世界之间只传字符串（JSON），互相拿不到对方的对象。

export const DIALOG_ARM_EVENT = '__plasticine_dialog_arm';
export const DIALOG_SEEN_EVENT = '__plasticine_dialog_seen';

/** 记下的那一次弹框。 */
export interface SeenDialog {
  type: string;
  message: string;
  answered: string;
  at: string;
}

/**
 * 装进页面世界（contextBridge.executeInMainWorld 按 func.toString() 带过去）：不能引外面的任何东西，事件名照抄上面两个。
 */
export function dialogGuard(): void {
  const original = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
  let armed: { accept: boolean; text: string | null } | null = null;
  window.addEventListener('__plasticine_dialog_arm', (event) => {
    const detail = (event as CustomEvent<string>).detail;
    armed = typeof detail === 'string' ? JSON.parse(detail) as { accept: boolean; text: string | null } : null;
  });
  const decide = (type: string, message: unknown, fallback: boolean)
    : { native: true } | { native: false; accept: boolean; text: string | null } => {
    if (armed === null && document.visibilityState !== 'hidden') return { native: true };
    const given = armed;
    armed = null;
    const accept = given === null ? fallback : given.accept;
    const record = { type, message: String(message ?? '').slice(0, 500), answered: accept ? '好' : '取消',
      at: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent('__plasticine_dialog_seen', { detail: JSON.stringify(record) }));
    return { native: false, accept, text: given === null ? null : given.text };
  };
  window.alert = (message?: unknown): void => {
    if (decide('alert', message, true).native) original.alert.call(window, message);
  };
  window.confirm = (message?: string): boolean => {
    const answer = decide('confirm', message, false);
    return answer.native ? original.confirm.call(window, message) : answer.accept;
  };
  window.prompt = (message?: string, value?: string): string | null => {
    const answer = decide('prompt', message, false);
    if (answer.native) return original.prompt.call(window, message, value);
    return answer.accept ? answer.text ?? value ?? '' : null;
  };
}
