// 一家模型的订阅登录（11-08 首次使用流程重做）：开始登录拿到授权页地址，然后——
// - 桌面客户端（有 external）：external.open 直接开系统浏览器；连的是远程实例（拿不到本机令牌）时同时
//   external.capture(1455, 10 分钟) 在这台电脑上等回调，拿到就交给本体已有的「贴回调地址」接口，界面只显示
//   「在浏览器里登录…」并自动完成；本机实例照旧由本体自己收回调。
// - 普通网页：新窗口开授权页；连的是远程实例时浏览器跳回的 localhost 在这台电脑上、本体收不到，留「贴回调地址」。
// - 旧 Swift Mac App（没有 external）：站外链接会开进 App 自己的标签、连接页看不到，只给复制链接 + 贴回调地址。
// 隔一会儿问一次走到哪了；登录成了、失败了、取消了都收拾掉在等的回调。

import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ModelProviderView, ProviderLoginView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { hostExternal, hostLocalGrant, inDesktopApp } from '../../shell/host.ts';

/** 隔多久问一次登录走到哪了（浏览器那边授权完，服务端自己收到回调）。 */
const LOGIN_POLL_MS = 2000;
/** 订阅登录（OpenAI / Anthropic 的 OAuth）回调到的本机端口，和本体收回调的端口一致。 */
export const OAUTH_CALLBACK_PORT = 1455;
/** 在这台电脑上等回调最多 10 分钟（授权页的有效期）。 */
export const OAUTH_CAPTURE_MS = 10 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 怎么拿回调：本体自己收、桌面客户端在本机等、他贴回来、旧 App 里复制链接再贴。 */
export type CallbackRoute = 'server' | 'capture' | 'paste' | 'copy';

async function callbackRoute(): Promise<CallbackRoute> {
  // 桌面客户端：拿得到本机令牌就是壳自己拉起的本机本体（它自己收回调），拿不到就是连着远程。
  if (hostExternal() !== null) {
    return (await hostLocalGrant()) !== null ? 'server' : 'capture';
  }
  const local = LOCAL_HOSTS.has(window.location.hostname);
  if (inDesktopApp()) {
    return 'copy';
  }
  return local ? 'server' : 'paste';
}

export interface ProviderLogin {
  login: ProviderLoginView | null;
  route: CallbackRoute | null;
  error: string | null;
  busy: boolean;
  /** 再开一次授权页（浏览器那边关掉了）。 */
  reopen: () => void;
  /** 交回调地址（贴回来的那一整串）。 */
  complete: (callback: string) => void;
  cancel: () => void;
}

export function useProviderLogin(provider: ModelProviderView, onDone: () => void, onCancel: () => void)
  : ProviderLogin {
  const api = useApi();
  const live = useLive();
  const [login, setLogin] = useState<ProviderLoginView | null>(null);
  const [route, setRoute] = useState<CallbackRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const capturing = useRef(false);
  const complete = (callback: string): void => {
    if (login === null || callback.trim() === '') return;
    setBusy(true);
    api.modelProviders.completeLogin(provider.id, login.id, createRequestId(), callback.trim()).then((view) => {
      setBusy(false);
      setLogin(view);
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  const open = (view: ProviderLoginView, how: CallbackRoute): void => {
    if (view.url === null) return;
    const external = hostExternal();
    if (external !== null) {
      external.open(view.url);
    } else if (how !== 'copy') {
      window.open(view.url, '_blank', 'noopener,noreferrer');
    }
    if (how === 'capture' && external !== null && !capturing.current) {
      capturing.current = true;
      void external.capture(OAUTH_CALLBACK_PORT, OAUTH_CAPTURE_MS).then((callback) => {
        capturing.current = false;
        if (callback === null) return;
        setBusy(true);
        api.modelProviders.completeLogin(provider.id, view.id, createRequestId(), callback).then((next) => {
          setBusy(false);
          setLogin(next);
        }, (cause: unknown) => {
          setBusy(false);
          setError(errorText(cause));
        });
      }, (cause: unknown) => {
        capturing.current = false;
        setError(errorText(cause));
      });
    }
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void Promise.all([callbackRoute(), api.modelProviders.startLogin(provider.id, createRequestId())])
      .then(([how, view]) => {
        setRoute(how);
        setLogin(view);
        open(view, how);
      }, (cause: unknown) => setError(errorText(cause)));
    // 只在这一家第一次挂上时开始一次（StrictMode 下挂两次也只开一次）；open 每次渲染都是新的，不进依赖。
  }, [api, provider.id]);
  useEffect(() => {
    if (login === null || login.status !== 'waiting') {
      return undefined;
    }
    const timer = setInterval(() => {
      api.modelProviders.login(provider.id, login.id).then(setLogin, (cause: unknown) => setError(errorText(cause)));
    }, LOGIN_POLL_MS);
    return () => clearInterval(timer);
  }, [api, login, provider.id]);
  useEffect(() => {
    if (login?.status === 'done') {
      if (capturing.current) hostExternal()?.cancelCapture();
      void live.models.reload().then(onDone);
    }
  }, [login?.status, live.models, onDone]);
  const cancel = (): void => {
    if (capturing.current) {
      capturing.current = false;
      hostExternal()?.cancelCapture();
    }
    if (login !== null && login.status === 'waiting') {
      api.modelProviders.cancelLogin(provider.id, login.id, createRequestId())
        .catch((cause: unknown) => console.warn('取消登录没送到，服务端那次登录会自己过期', cause));
    }
    onCancel();
  };
  const failed = error ?? login?.error ?? (login?.status === 'failed' ? '登录没成，再试一次。' : null);
  return { login, route, error: failed, busy, complete, cancel,
    reopen: () => { if (login !== null && route !== null) open(login, route); } };
}
