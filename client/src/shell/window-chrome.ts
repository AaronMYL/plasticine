// 桌面客户端的窗口外观（11-08 起红绿灯、Windows 窗口按钮都在界面自己画的标题栏里，titlebar.tsx）。壳经 host.ts 报
// 红绿灯让出多宽、是不是全屏、右上角窗口按钮让出多宽。Swift Mac App 还要网页把标题栏里按钮的矩形报回去（它认不了
// -webkit-app-region）；Electron 壳不要。协议在 agent/shared/api/mac-bridge.ts。网页版、手机、没有这条桥的旧 App：没有标题栏。

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

/** 标题栏里不可拖动的矩形：按钮、输入框、链接各一块，没大小的不报。 */
export function collectNoDrag(bar: Element): WebTabFrame[] {
  const frames: WebTabFrame[] = [];
  for (const element of bar.querySelectorAll('button, input, a')) {
    const frame = frameOf(element);
    if (frame.width > 0 && frame.height > 0 && frame.y < TITLEBAR_HEIGHT) {
      frames.push(frame);
    }
  }
  return frames.slice(0, HIT_REGIONS_MAX);
}

/**
 * 只给 Swift Mac App：把标题栏里按钮的矩形报过去，几何一变就重报（它的 WKWebView 认不了 -webkit-app-region，标题栏
 * 44px 里不在 noDrag 里的点击一律当拖窗口、先于网页）。Electron 壳没有 titlebar()，什么都不做。
 *
 * 什么时候量：挂上和 revision 变时当场量；之后标题栏里的 DOM 变了（页名、页面放进来的按钮）、大小变了、窗口改大小，
 * 都排到下一帧量（一帧里多次只量一次）。量出来和上次一样就不报。空闲时零开销。
 */
export function useTitlebarReport(bar: RefObject<HTMLElement | null>, revision: string): void {
  const bridge = hostWindowChrome();
  useLayoutEffect(() => {
    const element = bar.current;
    const send = bridge?.titlebar?.bind(bridge);
    if (send === undefined || element === null) {
      return undefined;
    }
    let disposed = false;
    let frame = 0;
    let last: WebTabFrame[] | null = null;
    const report = (): void => {
      frame = 0;
      if (disposed) {
        return;
      }
      const noDrag = collectNoDrag(element);
      if (last !== null && sameFrames(last, noDrag)) {
        return;
      }
      try {
        send({ height: TITLEBAR_HEIGHT, noDrag });
        last = noDrag;
      } catch (cause) {
        console.warn('标题栏的拖动区没能报给 Mac 原生层', cause);
      }
    };
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
    const mutations = new MutationObserver(schedule);
    mutations.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    sizes?.observe(element);
    window.addEventListener('resize', schedule);
    report();
    return () => {
      disposed = true;
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      mutations.disconnect();
      sizes?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [bar, bridge, revision]);
}
