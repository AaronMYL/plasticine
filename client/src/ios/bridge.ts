// iPhone 原生壳（ios/）注入的入口。壳的 User-Agent 末尾带 PlasticineIOS/<版本>，页面还没收到注入对象时也认得出。
import type { PlasticineIOSBridge } from '../api/shared.ts';

declare global {
  interface Window {
    plasticineIOS?: PlasticineIOSBridge;
    __plasticineAsk?: (text: string) => Promise<void>;
  }
}

export function isPlasticineIOS(): boolean {
  return window.plasticineIOS !== undefined || /(?:^|\s)PlasticineIOS\/[^\s]+(?:\s|$)/.test(navigator.userAgent);
}
