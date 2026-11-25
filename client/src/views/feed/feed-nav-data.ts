import { useEffect, useState } from 'react';
import { Value } from 'typebox/value';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { SiteLoginsSchema, type FeedNavResponse, type FeedNavSource } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { hostLogins } from '../../shell/host.ts';
import { useStore } from '../../state/use-store.ts';

const CHANGED = 'plasticine:feed-nav-changed';
const LOGIN_POLL_MS = 30_000;

export function feedNavChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

export interface FeedNavData {
  nav: FeedNavResponse | null;
  error: string | null;
}

export function useFeedNav(): FeedNavData {
  const api = useApi();
  const timeZone = useTimeZone();
  const live = useLive();
  const data = useStore(live.feed.data);
  const [nav, setNav] = useState<FeedNavResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  const revision = `${data.status}:${data.items.length}:${data.newToday}`;
  useEffect(() => {
    const again = (): void => setBump((count) => count + 1);
    window.addEventListener(CHANGED, again);
    return () => window.removeEventListener(CHANGED, again);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.feed.nav(timeZone, controller.signal).then((next) => {
      setNav(next);
      setError(null);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    return () => controller.abort();
  }, [api, timeZone, revision, bump]);
  return { nav, error };
}

export const LOGIN_SITES = {
  x: { url: 'https://x.com/login', title: 'X', login: '登录 X', open: '打开 X', hosts: ['x.com', 'twitter.com'] },
  douyin: { url: 'https://www.douyin.com/', title: '抖音', login: '登录抖音', open: '打开抖音',
    hosts: ['douyin.com'] },
  xhs: { url: 'https://www.xiaohongshu.com/explore', title: '小红书', login: '登录小红书', open: '打开小红书',
    hosts: ['xiaohongshu.com'] },
  reddit: { url: 'https://www.reddit.com/login/', title: 'Reddit', login: '登录 Reddit', open: '打开 Reddit',
    hosts: ['reddit.com'] },
} as const;
export type LoginKind = keyof typeof LOGIN_SITES;

export function isLoginKind(kind: FeedNavSource['kind']): kind is LoginKind {
  return kind === 'x' || kind === 'douyin' || kind === 'xhs' || kind === 'reddit';
}

export function useSiteLogins(): Readonly<Record<LoginKind, boolean>> | null {
  const [logins] = useState(hostLogins);
  const [state, setState] = useState<Readonly<Record<LoginKind, boolean>> | null>(null);
  useEffect(() => {
    if (logins === null) {
      return undefined;
    }
    let live = true;
    const read = (): void => {
      logins.sites().then((raw) => {
        if (!Value.Check(SiteLoginsSchema, raw)) {
          throw new Error('电脑回的登录清单格式不对');
        }
        const has = (hosts: readonly string[]): boolean => raw.sites.some((site) => hosts
          .some((host) => site.host === host || site.host.endsWith(`.${host}`)));
        if (live) {
          setState({ x: has(LOGIN_SITES.x.hosts), douyin: has(LOGIN_SITES.douyin.hosts),
            xhs: has(LOGIN_SITES.xhs.hosts), reddit: has(LOGIN_SITES.reddit.hosts) });
        }
      }).catch((cause: unknown) => {
        console.warn('没读到电脑上的登录状态', cause);
      });
    };
    read();
    window.addEventListener('focus', read);
    const timer = window.setInterval(read, LOGIN_POLL_MS);
    return () => {
      live = false;
      window.removeEventListener('focus', read);
      window.clearInterval(timer);
    };
  }, [logins]);
  return state;
}
