// 有会话才进壳；任何请求拿到 401 就回到配对页（《实施方案》第 5 节约定 3）。
// 配对会话即是本人的确认凭据，不再初始化另一层浏览器签名钥匙。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../api/context.tsx';
import { errorText } from '../api/errors.ts';
import type { SessionView } from '../api/types.ts';
import { useClientState } from '../state/context.tsx';
import { LoginView } from '../views/login/login-view.tsx';
import { clearPairingLink } from '../views/login/pairing-link.ts';

type Gate =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'signed-in' }
  | { status: 'error'; error: string };

export function SessionGate({ children }: { children: ReactNode }): ReactNode {
  const api = useApi();
  const { notesCache } = useClientState();
  const [gate, setGate] = useState<Gate>({ status: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api.session.current().then(
      (session) => {
        if (!live) {
          return;
        }
        setGate({ status: session === null ? 'signed-out' : 'signed-in' });
        if (session !== null) {
          clearPairingLink();
          notesCache.activate(session.device.id);
        } else { notesCache.clear(); }
      },
      (cause: unknown) => {
        if (live) {
          setGate({ status: 'error', error: errorText(cause) });
        }
      },
    );
    const signedOut = (): void => {
      notesCache.clear();
      setGate({ status: 'signed-out' });
    };
    const stop = api.onUnauthorized(signedOut);
    window.addEventListener('plasticine:logout', signedOut);
    return () => {
      live = false;
      stop();
      window.removeEventListener('plasticine:logout', signedOut);
    };
  }, [api, notesCache, attempt]);

  const onPaired = (session: SessionView): void => {
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
  if (gate.status === 'signed-out') {
    return <LoginView onPaired={onPaired} onSessionOpened={(session) => {
      notesCache.activate(session.device.id);
    }} />;
  }
  return children;
}
