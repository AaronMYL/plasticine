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
import { ConnectingScreen } from './connecting-screen.tsx';

type Gate =
  | { status: 'checking' }
  | { status: 'setup'; account: AccountState }
  | { status: 'signed-out'; account: AccountState | null }
  | { status: 'signed-in' }
  | { status: 'error'; error: string };

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

  const retry = (): void => {
    setGate({ status: 'checking' });
    setAttempt((value) => value + 1);
  };
  if (gate.status === 'checking' || gate.status === 'error') {
    return <ConnectingScreen key={attempt} error={gate.status === 'error' ? gate.error : null} onRetry={retry} />;
  }
  if (gate.status === 'setup') {
    return <><WindowDragStrip /><SetupView account={gate.account} onSignedIn={onSignedIn} /></>;
  }
  if (gate.status === 'signed-out') {
    return <><WindowDragStrip /><LoginView account={gate.account} onSignedIn={onSignedIn} /></>;
  }
  return children;
}
