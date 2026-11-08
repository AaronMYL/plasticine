// 桌面客户端的窗口外观（11-07 两层侧栏：Mac 的交通灯落在图标栏顶上；Windows 的窗口按钮在右上角）。壳经 host.ts 报
// 交通灯要不要留位置、是不是全屏、右上角要让出多宽；网页侧把窗口顶上一条（TITLEBAR_HEIGHT）里哪些矩形是按钮、输入框
// （不可拖动）报回去，其余空白处由壳当窗口拖动区。顶上那一条由各块自己标 data-titlebar（图标栏顶、第二栏顶、主区顶栏）。
// 协议在 agent/shared/api/mac-bridge.ts。网页版、手机、没有这条桥的旧 App：不留位置，不报。

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { Value } from 'typebox/value';
import {
  HIT_REGIONS_MAX, TITLEBAR_HEIGHT, WindowChromeSchema, type WebTabFrame, type WindowChrome,
} from '../api/shared.ts';
import { sameFrames } from './hit-regions.ts';
import { hostWindowChrome } from './host.ts';

declare global {
  interface Window {
    /** 原生层报窗口外观的变化（进出全屏）；进来先校验。 */
    __plasticineWindowChrome?: (event: unknown) => void;
  }
}

const NO_CHROME: WindowChrome = { trafficLightInset: 0, fullScreen: false };

function read(raw: unknown): WindowChrome | null {
  if (!Value.Check(WindowChromeSchema, raw)) {
    console.warn('Mac 原生层报来的窗口外观格式不对，没有用', raw);
    return null;
  }
  return raw;
}

/** 窗口外观：交通灯安全区（全屏时 0）、右上角窗口按钮要让出的宽度。 */
export function useWindowChrome(): WindowChrome {
  const bridge = hostWindowChrome();
  const [chrome, setChrome] = useState<WindowChrome>(() => {
    if (bridge === null) {
      return NO_CHROME;
    }
    try {
      return read(bridge.current()) ?? NO_CHROME;
    } catch (cause) {
      console.warn('没读到 Mac 窗口外观，顶栏不留交通灯的位置', cause);
      return NO_CHROME;
    }
  });
  useEffect(() => {
    if (bridge === null) {
      return undefined;
    }
    const receive = (event: unknown): void => {
      const next = read(event);
      if (next !== null) {
        setChrome(next);
      }
    };
    window.__plasticineWindowChrome = receive;
    return () => {
      if (window.__plasticineWindowChrome === receive) {
        delete window.__plasticineWindowChrome;
      }
    };
  }, [bridge]);
  return chrome.fullScreen ? { ...chrome, trafficLightInset: 0 } : chrome;
}

function frameOf(element: Element): WebTabFrame {
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

/** 标在一整块上：这一块整个不可拖动，块里的按钮不再单报（整条标签栏，含「+」和组小签）。 */
export const NO_DRAG_ATTRIBUTE = 'data-no-drag';
const NO_DRAG_SELECTOR = `button, input, a, [${NO_DRAG_ATTRIBUTE}]`;

/**
 * 顶栏里不可拖动的矩形：按钮、输入框、链接各一块；标了 data-no-drag 的整块算一块，块里的不再单报——
 * 标签之间、标签里图标和字之间的缝不会漏成拖动区，标签再多也只是一块（不碰 HIT_REGIONS_MAX）。
 */
export function collectNoDrag(bar: Element): WebTabFrame[] {
  return collectIn(bar).slice(0, HIT_REGIONS_MAX);
}

/** 窗口顶上一条里标了 data-titlebar 的各块：每块里的不可拖动矩形，只留压在顶上 TITLEBAR_HEIGHT 里的。 */
export const TITLEBAR_ATTRIBUTE = 'data-titlebar';

export function collectTitlebar(root: Element): WebTabFrame[] {
  const frames: WebTabFrame[] = [];
  for (const block of root.querySelectorAll(`[${TITLEBAR_ATTRIBUTE}]`)) {
    for (const frame of collectIn(block)) {
      if (frame.y < TITLEBAR_HEIGHT) {
        frames.push(frame);
      }
    }
  }
  return frames.slice(0, HIT_REGIONS_MAX);
}

function collectIn(bar: Element): WebTabFrame[] {
  const frames: WebTabFrame[] = [];
  for (const element of bar.querySelectorAll(NO_DRAG_SELECTOR)) {
    const block = element.parentElement?.closest(`[${NO_DRAG_ATTRIBUTE}]`) ?? null;
    if (block !== null && bar.contains(block)) {
      continue;
    }
    const frame = frameOf(element);
    if (frame.width > 0 && frame.height > 0) {
      frames.push(frame);
    }
  }
  return frames;
}

/**
 * 把顶栏的不可拖动区报给原生，几何一变就重报。原生把顶栏 44px 里不在 noDrag 里的点击一律当拖窗口、先于网页，
 * 报慢了就是「点标签没反应」（2026-11-04）。
 *
 * 什么时候量：挂上和 revision 变时当场量；之后顶栏里的 DOM 变了（切当前标签、改标题、开关标签、拖动时的 transform）、
 * 有块变了大小（ResizeObserver）、标签条横向滚动、窗口改大小，都排到下一帧量（一帧里多次只量一次）；量的时候顶栏里
 * 还有动画在播（开标签从 0 宽长出来、补位平移、拖完回位——子组件先开始动画，当场量到的是第 0 帧），等它播完或被取消
 * 再量一次。量出来和上次一样就不报。
 * 不像 useHitRegions 那样一直逐帧量：顶栏在 Mac App 里一直都在，空闲时每秒 60 次唤醒主线程只为确认没变，费电；
 * 这样空闲时零开销，有变化时一次也只量五六个矩形。
 */
export function useTitlebarReport(bar: RefObject<HTMLElement | null>, revision: string): void {
  const bridge = hostWindowChrome();
  useLayoutEffect(() => {
    const element = bar.current;
    if (bridge === null || element === null) {
      return undefined;
    }
    let disposed = false;
    let frame = 0;
    let last: WebTabFrame[] | null = null;
    const awaited = new WeakSet<Animation>();
    const schedule = (): void => {
      if (disposed || frame !== 0) {
        return;
      }
      if (typeof window.requestAnimationFrame !== 'function') {
        report();
        return;
      }
      frame = window.requestAnimationFrame(report);
    };
    const awaitAnimations = (): void => {
      if (typeof element.getAnimations !== 'function') {
        return;
      }
      for (const animation of element.getAnimations({ subtree: true })) {
        if (!awaited.has(animation)) {
          awaited.add(animation);
          // 播完 resolve、被取消（关标签被打断）reject：两种结局都是停了，都再量一次。
          animation.finished.then(schedule, schedule);
        }
      }
    };
    const report = (): void => {
      frame = 0;
      if (disposed) {
        return;
      }
      const noDrag = collectTitlebar(element);
      if (last === null || !sameFrames(last, noDrag)) {
        try {
          bridge.titlebar({ height: TITLEBAR_HEIGHT, noDrag });
          last = noDrag;
        } catch (cause) {
          console.warn('顶栏的拖动区没能报给 Mac 原生层', cause);
        }
      }
      awaitAnimations();
    };
    // 只看顶上那几块（别处的变化——对话流式出字——不该把主线程叫醒）；换栏目、换页时 revision 变，重新找这几块。
    const mutations = new MutationObserver(schedule);
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    for (const block of element.querySelectorAll(`[${TITLEBAR_ATTRIBUTE}]`)) {
      mutations.observe(block, { subtree: true, childList: true, attributes: true, characterData: true });
      sizes?.observe(block);
    }
    // scroll 不冒泡：在顶栏上按捕获阶段听，标签条（.tabstrip-list）横向滚动也听得到。
    element.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    report();
    return () => {
      disposed = true;
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      mutations.disconnect();
      sizes?.disconnect();
      element.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [bar, bridge, revision]);
}
