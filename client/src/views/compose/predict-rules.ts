export const PREDICT_PAUSE_MS = 400;
export const MIN_VISIBLE_MS = 1500;
const IME_KEY_CODE = 229;

export function imeBusy(event: { isComposing?: boolean; keyCode?: number }, composing = false): boolean {
  return composing || event.isComposing === true || event.keyCode === IME_KEY_CODE;
}
