// 点在原生网页标签上（Mac App，2026-11-05 第 3 条）：网页标签是原生 WKWebView，点它时外层文档收不到 pointerdown，
// window blur 也不一定来。原生层用 NSEvent 本地监视器看到点落在网页标签上，就调 window.__plasticineNativePointer()
// （web-window.swift 的 nativePointer）；这里把它变成 window 上的 NATIVE_POINTER_EVENT，非模态浮层的关闭钩子听它收起。

export const NATIVE_POINTER_EVENT = 'plasticine:native-pointer';

declare global {
  interface Window {
    /** 原生层：点落在网页标签上（只是个信号，没有参数）。 */
    __plasticineNativePointer?: () => void;
  }
}

/** 装上原生调的入口；重复调只装一次。 */
export function installNativePointer(): void {
  window.__plasticineNativePointer ??= () => {
    window.dispatchEvent(new Event(NATIVE_POINTER_EVENT));
  };
}
