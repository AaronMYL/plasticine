export const NATIVE_POINTER_EVENT = 'plasticine:native-pointer';

declare global {
  interface Window {
    __plasticineNativePointer?: () => void;
  }
}

export function installNativePointer(): void {
  window.__plasticineNativePointer ??= () => {
    window.dispatchEvent(new Event(NATIVE_POINTER_EVENT));
  };
}
