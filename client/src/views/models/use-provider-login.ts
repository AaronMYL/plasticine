import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ModelProviderView, ProviderLoginView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { hostExternal, hostLocalGrant } from '../../shell/host.ts';

const LOGIN_POLL_MS = 2000;
export const OAUTH_CALLBACK_PORT = 1455;
export const OAUTH_CAPTURE_MS = 10 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type CallbackRoute = 'server' | 'capture' | 'paste';

async function callbackRoute(): Promise<CallbackRoute> {
  if (hostExternal() !== null) {
    return (await hostLocalGrant()) !== null ? 'server' : 'capture';
  }
  return LOCAL_HOSTS.has(window.location.hostname) ? 'server' : 'paste';
}

export interface ProviderLogin {
  login: ProviderLoginView | null;
  route: CallbackRoute | null;
  error: string | null;
  busy: boolean;
  reopen: () => void;
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
    } else {
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
  const failed = error ?? login?.error ?? (login?.status === 'failed' ? '登录没成，请重试。' : null);
  return { login, route, error: failed, busy, complete, cancel,
    reopen: () => { if (login !== null && route !== null) open(login, route); } };
}
