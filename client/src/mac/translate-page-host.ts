// 沉浸式翻译注入脚本在浏览器里的外部能力（从 translate-page.ts 拆出来：那份只管切段、排队、插译文）。
// IntersectionObserver 看视口和往下一屏，setTimeout 攒批，消息交给原生层给的 post。和另外三份一起由
// scripts/generate-translate-script.ts 拼进注入脚本，所以只能 import type。

import type { TranslatePriority } from '../api/shared.ts';
import type { TranslatorHost, TranslatorOutbound } from './translate-page.ts';

/** 浏览器里的实现：IntersectionObserver 看视口和往下一屏，setTimeout 攒批。 */
export function browserHost(post: (message: TranslatorOutbound) => void): TranslatorHost {
  const where = (element: Element): TranslatePriority | null => {
    if (element.getClientRects().length === 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const height = window.innerHeight;
    if (rect.bottom > 0 && rect.top < height) {
      return 'visible';
    }
    return rect.top >= height && rect.top < height * 2 ? 'ahead' : null;
  };
  return {
    document,
    post,
    now: () => performance.now(),
    schedule(callback, ms) {
      const handle = setTimeout(callback, ms);
      return () => clearTimeout(handle);
    },
    where,
    watcher(onEnter) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const rect = entry.boundingClientRect;
            onEnter(entry.target, rect.top < window.innerHeight && rect.bottom > 0 ? 'visible' : 'ahead');
          }
        }
      }, { rootMargin: '0px 0px 100% 0px' });
      return {
        watch: (element) => observer.observe(element),
        unwatch: (element) => observer.unobserve(element),
        disconnect: () => observer.disconnect(),
      };
    },
  };
}
