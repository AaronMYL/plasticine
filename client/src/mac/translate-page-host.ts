import type { TranslatePriority } from '../api/shared.ts';
import type { TranslatorHost, TranslatorOutbound } from './translate-page.ts';

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
