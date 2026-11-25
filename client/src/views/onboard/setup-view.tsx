import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { DEFAULT_MAIN_NAME, DISPLAY_NAME_MAX_CHARS, PASSWORD_MIN_CHARS, type AccountState,
  type SessionView } from '../../api/shared.ts';
import { hostLocalGrant, hostProfile } from '../../shell/host.ts';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { mainChatRoute, routeHash } from '../../shell/routes.ts';
import { TooltipLayer } from '../../shell/tooltip.tsx';
import { HandleField, handleBlocks, normalizeHandle, useHandleCheck } from './handle-field.tsx';
import { handleHost } from './handle.ts';
import { ChangePlace, PasswordField, suggestedDeviceName } from './onboard-parts.tsx';

const SETUP_PREFIX = '#/setup';
export const MAIN_LINE_HASH = routeHash(mainChatRoute());
const AI_NAME_MIN = 2;
const AI_NAME_MAX = 20;
const AI_NAME_TIP = '你的 AI 的名字，朋友那边也显示它；以后在主线的编辑里还能改';

export function setupTokenOf(hash: string = window.location.hash): string | null {
  if (!hash.startsWith(SETUP_PREFIX)) {
    return null;
  }
  const query = hash.indexOf('?');
  const token = query < 0 ? null : new URLSearchParams(hash.slice(query + 1)).get('t');
  return token === null || token.trim() === '' ? null : token.trim();
}

function LockedHandle({ handle }: { handle: string }): ReactNode {
  return (
    <div className="ob-field">
      <span className="ob-label">@账号</span>
      <div className="ob-input ob-locked">
        <span className="ob-locked-value">@{handle}</span>
        <span role="img" aria-label="安装时已经起好"><Icon name="lock" size={14} /></span>
      </div>
      <p className="ob-note">{handleHost(handle)}</p>
    </div>
  );
}

export function SetupView({ account, onSignedIn }: { account?: AccountState | null;
  onSignedIn: (session: SessionView) => void }): ReactNode {
  const api = useApi();
  const lockedHandle = account?.handle ?? null;
  const [name, setName] = useState('');
  const [aiName, setAiName] = useState(DEFAULT_MAIN_NAME);
  const [handleInput, setHandleInput] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupToken] = useState(() => setupTokenOf());
  const [localToken, setLocalToken] = useState<string | null>(null);
  const handle = normalizeHandle(handleInput);
  const check = useHandleCheck(lockedHandle === null ? handle : '');
  useEffect(() => {
    let alive = true;
    void hostLocalGrant().then((token) => {
      if (alive) setLocalToken(token);
    });
    void hostProfile().then((profile) => {
      if (alive && profile?.fullName != null) setName((current) => (current === '' ? profile.fullName ?? '' : current));
    });
    return () => {
      alive = false;
    };
  }, []);
  const ai = aiName.trim();
  const short = password.length > 0 && password.length < PASSWORD_MIN_CHARS;
  const handleReady = lockedHandle !== null || (handle !== '' && !handleBlocks(check));
  const ready = name.trim() !== '' && ai.length >= AI_NAME_MIN && password.length >= PASSWORD_MIN_CHARS
    && handleReady && !busy;
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    api.account.setup({ displayName: name.trim(), handle: lockedHandle === null ? handle : null, password,
      deviceName: suggestedDeviceName(), ...(setupToken === null ? {} : { setupToken }) }, localToken)
      .then(async (answer) => {
        if (ai !== DEFAULT_MAIN_NAME) {
          try {
            await api.mates.updateMain({ requestId: createRequestId(), name: ai });
          } catch (cause) {
            console.warn('主线的名字没改成，以后在主线的编辑里改', cause);
          }
        }
        window.history.replaceState(window.history.state, '', `${window.location.pathname}${MAIN_LINE_HASH}`);
        onSignedIn(answer.session);
      }, (cause: unknown) => {
        setBusy(false);
        setError(errorText(cause));
      });
  };
  return (
    <main className="ob-page ob-chat" aria-label="建账号">
      <div className="ob-chat-col">
        <div className="ob-hello">
          <div className="ob-hello-head"><PlasticineMark size={20} /><span>Plasticine</span></div>
          <p>你好，我是 Plasticine。先把账号建好，再连一个模型。</p>
        </div>
        <form className="ob-card" aria-label="建账号" onSubmit={submit} noValidate>
          <h1 className="ob-card-title">建账号</h1>
          <div className="ob-field">
            <label className="ob-label" htmlFor="setup-name">叫你什么</label>
            <div className="ob-input">
              <input id="setup-name" value={name} autoFocus autoComplete="name" maxLength={DISPLAY_NAME_MAX_CHARS}
                disabled={busy} onChange={(event) => setName(event.target.value)} />
            </div>
          </div>
          <div className="ob-field">
            <span className="ob-label">
              <label htmlFor="setup-ai-name">叫我什么</label>
              <InfoTip text={AI_NAME_TIP} label="「叫我什么」的说明" side="right" />
            </span>
            <div className="ob-input">
              <input id="setup-ai-name" value={aiName} maxLength={AI_NAME_MAX} disabled={busy}
                onChange={(event) => setAiName(event.target.value)} />
            </div>
          </div>
          {lockedHandle === null ? (
            <HandleField id="setup-handle" value={handleInput} onChange={setHandleInput} check={check}
              disabled={busy} />
          ) : <LockedHandle handle={lockedHandle} />}
          <PasswordField id="setup-password" label="密码" value={password} onChange={setPassword}
            autoComplete="new-password" disabled={busy} describedBy="setup-password-note" />
          {short ? <p id="setup-password-note" className="ob-note">至少 {PASSWORD_MIN_CHARS} 位</p> : null}
          {error === null ? null : <p className="ob-error" role="alert">{error}</p>}
          <div className="ob-card-actions">
            <button type="submit" className="primary-button" disabled={!ready}>
              {busy ? '正在创建…' : '创建'}
            </button>
          </div>
        </form>
        <div className="ob-links ob-links-center"><ChangePlace /></div>
      </div>
      <TooltipLayer />
    </main>
  );
}
