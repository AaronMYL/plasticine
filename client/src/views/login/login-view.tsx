import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { AccountState, SessionView } from '../../api/shared.ts';
import { handleHost, loginTarget, normalizeHandle, validHandle } from '../onboard/handle.ts';
import { Brand, ChangePlace, PasswordField, suggestedDeviceName } from '../onboard/onboard-parts.tsx';
import './login.css';

const FORGOT_TEXT = '密码只存在你自己的 Plasticine 里。在装着它的那台电脑上打开 Plasticine 就能重设；'
  + '装在服务器上的，在服务器上运行 ';

function addressOf(input: string): string | null {
  const handle = normalizeHandle(input);
  return handle !== '' && !/[.:/]/.test(input) && validHandle(handle) ? handleHost(handle) : null;
}

function Forgot(): ReactNode {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent): void => {
      if (event.target instanceof Node && box.current?.contains(event.target) !== true) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="ob-forgot" ref={box}>
      <button type="button" className="ob-link ob-link-u" aria-expanded={open} aria-controls="login-forgot"
        onClick={() => setOpen((value) => !value)}>忘了密码</button>
      {open ? <div id="login-forgot" className="ob-forgot-pop" role="tooltip">
        <p>{FORGOT_TEXT}<code>plasticine password</code>。</p>
      </div> : null}
    </div>
  );
}

export interface LoginViewProps {
  account: AccountState | null;
  onSignedIn: (session: SessionView) => void;
  navigate?: (url: string) => void;
}

export function LoginView({ account, onSignedIn, navigate = (url) => window.location.assign(url) }: LoginViewProps)
  : ReactNode {
  const api = useApi();
  const [who, setWho] = useState(account?.handle ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = loginTarget(who, account === null ? undefined : account.handle, new URL(window.location.href));
  const address = addressOf(who);
  const ready = !busy && (target.kind === 'elsewhere' || (target.kind === 'here' && password !== ''));
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (target.kind === 'bad') {
      setError('认不出这个 @账号或地址。');
      return;
    }
    if (target.kind === 'elsewhere') {
      navigate(target.url);
      return;
    }
    if (password === '') return;
    setBusy(true);
    setError(null);
    api.account.signIn({ password, deviceName: suggestedDeviceName() }).then(onSignedIn, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  return (
    <main className="ob-page login" aria-label="登录">
      <div className="ob-col">
        <Brand />
        <h1 className="ob-title">登录</h1>
        <form onSubmit={submit} noValidate>
          <div className="ob-field">
            <label className="ob-label" htmlFor="login-who">@账号或地址</label>
            <div className="ob-input" data-invalid={target.kind === 'bad' && error !== null}>
              <span className="ob-pre" aria-hidden="true">@</span>
              <input id="login-who" value={who} autoComplete="username" autoCapitalize="none" spellCheck={false}
                inputMode="email" disabled={busy} autoFocus={account?.handle == null}
                onChange={(event) => {
                  setWho(event.target.value);
                  setError(null);
                }} />
              {address === null ? null : <span className="ob-suffix login-address">{address}</span>}
            </div>
          </div>
          <PasswordField id="login-password" label="密码" value={password} autoComplete="current-password"
            disabled={busy || target.kind === 'elsewhere'} autoFocus={account?.handle != null}
            invalid={error !== null && target.kind === 'here'}
            onChange={(value) => {
              setPassword(value);
              setError(null);
            }} />
          {error === null ? null : <p className="ob-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button ob-big" disabled={!ready}>
            {busy ? '正在登录…' : '登录'}
          </button>
        </form>
        <div className="ob-links login-links"><ChangePlace /><span className="login-gap" /><Forgot /></div>
      </div>
    </main>
  );
}
