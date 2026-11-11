// 建账号（11-08 设计稿 Create-Account，首次使用流程第 1 步）：叫你什么、@账号、密码、「创建」。
// 凭本机令牌（桌面客户端里经 server.localGrant() 取，放请求头）或地址里 #/setup?t=… 的一次性令牌（Linux 装完打印的
// 链接）。建成了登记这台设备、拿到会话，接着连模型（第 2 步）、在手机上也能用（第 3 步），最后落在主线。
// 出错就地一行（令牌过期、@账号被占、被限流都是服务端那句），不弹框。

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { DISPLAY_NAME_MAX_CHARS, PASSWORD_MIN_CHARS, type SessionView } from '../../api/shared.ts';
import { hostLocalGrant } from '../../shell/host.ts';
import { mainChatRoute, routeHash } from '../../shell/routes.ts';
import { TooltipLayer } from '../../shell/tooltip.tsx';
import { startFirstRun } from './first-run.ts';
import { HandleField, handleBlocks, normalizeHandle, useHandleCheck } from './handle-field.tsx';
import { ChangePlace, PasswordField, Stepper, suggestedDeviceName } from './onboard-parts.tsx';

const SETUP_PREFIX = '#/setup';
/** 建完落在主线（设计稿 First-Main）。 */
export const MAIN_LINE_HASH = routeHash(mainChatRoute());

/** 地址里 #/setup?t=… 的建账号令牌；没有是 null。只在内存里用，建完就从地址里拿掉。 */
export function setupTokenOf(hash: string = window.location.hash): string | null {
  if (!hash.startsWith(SETUP_PREFIX)) {
    return null;
  }
  const query = hash.indexOf('?');
  const token = query < 0 ? null : new URLSearchParams(hash.slice(query + 1)).get('t');
  return token === null || token.trim() === '' ? null : token.trim();
}

export function isSetupHash(hash: string = window.location.hash): boolean {
  return hash === SETUP_PREFIX || hash.startsWith(`${SETUP_PREFIX}?`) || hash.startsWith(`${SETUP_PREFIX}/`);
}

export function SetupView({ onSignedIn }: { onSignedIn: (session: SessionView) => void }): ReactNode {
  const api = useApi();
  const [name, setName] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupToken] = useState(() => setupTokenOf());
  const [localToken, setLocalToken] = useState<string | null>(null);
  const handle = normalizeHandle(handleInput);
  const check = useHandleCheck(handle);
  useEffect(() => {
    let alive = true;
    void hostLocalGrant().then((token) => {
      if (alive) setLocalToken(token);
    });
    return () => {
      alive = false;
    };
  }, []);
  const short = password.length > 0 && password.length < PASSWORD_MIN_CHARS;
  const ready = name.trim() !== '' && password.length >= PASSWORD_MIN_CHARS && !handleBlocks(check) && !busy;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    api.account.setup({ displayName: name.trim(), handle: handle === '' ? null : handle, password,
      deviceName: suggestedDeviceName(), ...(setupToken === null ? {} : { setupToken }) }, localToken)
      .then((answer) => {
        startFirstRun();
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${MAIN_LINE_HASH}`);
        onSignedIn(answer.session);
      }, (cause: unknown) => {
        setBusy(false);
        setError(errorText(cause));
      });
  };
  return (
    <main className="ob-page" aria-label="建一个账号">
      <div className="ob-col">
        <Stepper at={1} />
        <h1 className="ob-title">建一个账号</h1>
        <form onSubmit={submit} noValidate>
          <div className="ob-field">
            <label className="ob-label" htmlFor="setup-name">叫你什么</label>
            <div className="ob-input">
              <input id="setup-name" value={name} autoFocus autoComplete="name" maxLength={DISPLAY_NAME_MAX_CHARS}
                disabled={busy} onChange={(event) => setName(event.target.value)} />
            </div>
          </div>
          <HandleField id="setup-handle" value={handleInput} onChange={setHandleInput} check={check}
            disabled={busy} />
          <PasswordField id="setup-password" label="密码" value={password} onChange={setPassword}
            autoComplete="new-password" disabled={busy} describedBy="setup-password-note" />
          {short ? <p id="setup-password-note" className="ob-note">至少 {PASSWORD_MIN_CHARS} 位</p> : null}
          {error === null ? null : <p className="ob-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button ob-big" disabled={!ready}>
            {busy ? '正在创建…' : '创建'}
          </button>
        </form>
        <div className="ob-links ob-links-center"><ChangePlace /></div>
      </div>
      <TooltipLayer />
    </main>
  );
}
