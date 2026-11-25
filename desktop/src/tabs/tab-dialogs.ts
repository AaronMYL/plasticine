export const DIALOG_ARM_EVENT = '__plasticine_dialog_arm';
export const DIALOG_SEEN_EVENT = '__plasticine_dialog_seen';

export interface SeenDialog {
  type: string;
  message: string;
  answered: string;
  at: string;
}

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
