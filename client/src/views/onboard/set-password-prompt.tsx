import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { PASSWORD_MIN_CHARS, type AccountState } from '../../api/shared.ts';
import { hostLocalGrant } from '../../shell/host.ts';
import { PasswordField } from './onboard-parts.tsx';
import '../../shell/dialog.css';
import './set-password.css';

export const PASSWORD_LATER_KEY = 'plasticine.passwordPrompt.later';
export const PASSWORD_ASK_GAP_MS = 24 * 60 * 60 * 1000;

function askedRecently(now: number): boolean {
  try {
    const at = Date.parse(window.localStorage.getItem(PASSWORD_LATER_KEY) ?? '');
    return Number.isFinite(at) && now - at < PASSWORD_ASK_GAP_MS;
  } catch (cause) {
    console.warn('读不到「以后再说」的记录，照常问', cause);
    return false;
  }
}

function rememberLater(now: number): void {
  try {
    window.localStorage.setItem(PASSWORD_LATER_KEY, new Date(now).toISOString());
  } catch (cause) {
    console.warn('记不下「以后再说」，下次打开还会问', cause);
  }
}

function PasswordDialog({ state, onClose }: { state: AccountState; onClose: (later: boolean) => void }): ReactNode {
  const api = useApi();
  const titleId = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !busy && password.length >= PASSWORD_MIN_CHARS;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    void hostLocalGrant().then((token) => api.account.setPassword({ password }, token))
      .then(() => onClose(false), (cause: unknown) => {
        setBusy(false);
        setError(errorText(cause));
      });
  };
  const who = state.handle === null ? '' : `给 @${state.handle} `;
  return (
    <div className="dialog-layer set-password-scrim" role="presentation" onKeyDown={(event) => {
      if (event.key === 'Escape' && !busy) onClose(true);
    }}>
      <form className="dialog set-password" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onSubmit={submit}>
        <h2 id={titleId} className="dialog-title">{who}设一个密码</h2>
        <p className="dialog-text">以后新设备用 @账号和密码登录，不再要配对码。已登录的设备不受影响。</p>
        <PasswordField id="set-password-new" label="密码" value={password} autoComplete="new-password" autoFocus
          disabled={busy} onChange={(value) => {
            setPassword(value);
            setError(null);
          }} />
        {password.length > 0 && password.length < PASSWORD_MIN_CHARS
          ? <p className="ob-note">至少 {PASSWORD_MIN_CHARS} 位</p> : null}
        {error === null ? null : <p className="ob-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => onClose(true)}>以后再说</button>
          <button type="submit" className="primary-button" disabled={!ready}>{busy ? '正在设…' : '设好了'}</button>
        </div>
      </form>
    </div>
  );
}

export function SetPasswordPrompt({ now = Date.now }: { now?: () => number }): ReactNode {
  const api = useApi();
  const [state, setState] = useState<AccountState | null>(null);
  useEffect(() => {
    if (askedRecently(now())) return undefined;
    const controller = new AbortController();
    api.account.state(controller.signal).then((value) => {
      if (!controller.signal.aborted && !value.passwordSet && value.setup === 'done') setState(value);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) console.warn('没读到账号状态，这次不问设密码', cause);
    });
    return () => controller.abort();
  }, [api, now]);
  if (state === null) {
    return null;
  }
  return <PasswordDialog state={state} onClose={(later) => {
    if (later) rememberLater(now());
    setState(null);
  }} />;
}
