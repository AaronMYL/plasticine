// 有会话才进壳；任何请求拿到 401 就回到登录页（《实施方案》第 5 节约定 3）。
// 11-08 首次使用流程：没登录时先读 /v2/account/state——还没有主人（setup = needed）直接到建账号（11-12 起是主线样子的
// 一列，setup-view.tsx）；
// 已经有主人的到登录页（@账号 + 密码）。桌面客户端里载入的是壳拉起的本机本体时，凭本机令牌直接登录，不问密码。
// 读不到账号状态（旧服务端、断网）不挡：照样给登录页，登录时服务端自己说清。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../api/context.tsx';
import { errorText } from '../api/errors.ts';
import type { PlasticineApi } from '../api/client.ts';
import type { AccountState, SessionView } from '../api/shared.ts';
import { useClientState } from '../state/context.tsx';
import { LoginView } from '../views/login/login-view.tsx';
import { suggestedDeviceName } from '../views/onboard/onboard-parts.tsx';
import { SetupView } from '../views/onboard/setup-view.tsx';
import { WindowDragStrip } from './window-drag-strip.tsx';
import { hostLocalGrant } from './host.ts';

type Gate =
  | { status: 'checking' }
  | { status: 'setup'; account: AccountState }
  | { status: 'signed-out'; account: AccountState | null }
  | { status: 'signed-in' }
  | { status: 'error'; error: string };

/** 没登录时去哪：建账号、本机直接登录，或登录页。 */
async function signedOutGate(api: PlasticineApi): Promise<Gate | SessionView> {
  let account: AccountState | null = null;
  try {
    account = await api.account.state();
  } catch (cause) {
    console.warn('没读到账号状态，照样给登录页', cause);
  }
  if (account?.setup === 'needed') {
    return { status: 'setup', account };
  }
  const token = await hostLocalGrant();
  if (token !== null) {
    try {
      return await api.account.signInLocal(suggestedDeviceName(), token);
    } catch (cause) {
      console.warn('本机直接登录没成，给登录页', cause);
    }
  }
  return { status: 'signed-out', account };
}

function isSession(value: Gate | SessionView): value is SessionView {
  return 'device' in value;
}

/**
 * 已经登录着却打开了登录 / 建账号页（桌面客户端连远程时直接载入 <地址>/#/login）：换成首页，不停在登录页。
 * 建账号页刚建完的那次已经换成了主线。
 */
function leaveSignInHash(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/login') || hash.startsWith('#/setup')) {
    const { pathname, search } = window.location;
    window.history.replaceState(window.history.state, '', `${pathname}${search}#/today`);
  }
}

export function SessionGate({ children }: { children: ReactNode }): ReactNode {
  const api = useApi();
  const { notesCache } = useClientState();
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const settle = (next: Gate | SessionView): void => {
      if (!live) return;
      if (isSession(next)) {
        leaveSignInHash();
        notesCache.activate(next.device.id);
        setGate({ status: 'signed-in' });
      } else {
        if (next.status !== 'signed-in') notesCache.clear();
        setGate(next);
      }
    };
    const signedOut = (): void => {
      notesCache.clear();
      setGate({ status: 'checking' });
      void signedOutGate(api).then(settle);
    };
    api.session.current().then(
      (session) => {
        if (session !== null) settle(session);
        else void signedOutGate(api).then(settle);
      },
      (cause: unknown) => {
        if (live) setGate({ status: 'error', error: errorText(cause) });
      },
    );
    const stop = api.onUnauthorized(signedOut);
    window.addEventListener('plasticine:logout', signedOut);
    return () => {
      live = false;
      stop();
      window.removeEventListener('plasticine:logout', signedOut);
    };
  }, [api, notesCache, attempt]);

  const onSignedIn = (session: SessionView): void => {
    leaveSignInHash();
    notesCache.activate(session.device.id);
    setGate({ status: 'signed-in' });
  };

  if (gate.status === 'checking') {
    return <p className="gate-note">正在连接…</p>;
  }
  if (gate.status === 'error') {
    return (
      <p className="gate-note is-error" role="alert">
        {gate.error}
        <button type="button" className="chip-button" onClick={() => {
          setGate({ status: 'checking' }); setAttempt((value) => value + 1);
        }}>重新连接</button>
      </p>
    );
  }
  if (gate.status === 'setup') {
    return <><WindowDragStrip /><SetupView account={gate.account} onSignedIn={onSignedIn} /></>;
  }
  if (gate.status === 'signed-out') {
    return <><WindowDragStrip /><LoginView account={gate.account} onSignedIn={onSignedIn} /></>;
  }
  return children;
}
