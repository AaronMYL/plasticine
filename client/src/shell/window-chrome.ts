import { useEffect, useState } from 'react';
import { Value } from 'typebox/value';
import { WindowChromeSchema, type WindowChrome } from '../api/shared.ts';
import { hostWindowChrome } from './host.ts';

declare global {
  interface Window {
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
