// 桌面客户端的窗口外观（11-08 起红绿灯、Windows 窗口按钮都在界面自己画的标题栏里，titlebar.tsx）。壳经 host.ts 报
// 红绿灯让出多宽、是不是全屏、右上角窗口按钮让出多宽；拖窗口靠标题栏自己标的 -webkit-app-region。协议在
// agent/shared/api/mac-bridge.ts。网页版、手机：没有标题栏。

import { useEffect, useState } from 'react';
import { Value } from 'typebox/value';
import { WindowChromeSchema, type WindowChrome } from '../api/shared.ts';
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
    console.warn('桌面壳报来的窗口外观格式不对，没有用', raw);
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
      console.warn('没读到桌面壳的窗口外观，顶栏不留交通灯的位置', cause);
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
