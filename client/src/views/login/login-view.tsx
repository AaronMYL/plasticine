// 配对这台设备：输入服务器上生成的一次性配对码，换一个长期会话（第 90 条 ②）。
// 配对码不是密码，不存、不写日志；失败时写一句原因和下一步。服务端的码是 8 位字母数字（7KQ4-M2XD），空格、
// 连字符、大小写都不要紧。每次配对带一个 requestId：回执丢了（超时、断网）再点「配对」，码和设备名没改就沿用
// 同一个标识，服务端认出是同一次配对，给已登记的那台设备一个新会话，不会拿已用掉的码报错，也不多登记一台。

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { ApiError, errorText, isUncertain } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { DEVICE_NAME_MAX_CHARS, PAIRING_CODE_INPUT_MAX_CHARS } from '../../api/shared.ts';
import type { SessionView } from '../../api/types.ts';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { Icon } from '../../shell/icons.tsx';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { usePhone } from '../../shell/use-viewport-width.ts';
import { clearPairingLink, readPairingInvitation } from './pairing-link.ts';
import './login.css';

/** 没填设备名时用这个（服务端要求设备名非空）。 */
const DEFAULT_DEVICE_NAME = '这台设备';

/** 一次配对：用哪个标识、对应哪个码和设备名。 */
interface PairingAttempt {
  requestId: string;
  key: string;
}

/** 和服务端一样忽略空格、连字符、大小写：只是写法不同的同一个码，算同一次配对。 */
function attemptKey(code: string, deviceName: string): string {
  return `${code.replace(/[\s-]/g, '').toUpperCase()}\n${deviceName}`;
}

export function LoginView({ onPaired, onSessionOpened }: { onPaired: (session: SessionView) => void;
  onSessionOpened?: (session: SessionView) => void }): ReactNode {
  const api = useApi();
  const phone = usePhone();
  const [invitation, setInvitation] = useState(readPairingInvitation);
  const [code, setCode] = useState(invitation?.code ?? '');
  const [deviceName, setDeviceName] = useState(invitation === null ? '' : suggestedDeviceName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(invitation !== null && Date.parse(invitation.expiresAt) <= Date.now());
  const [uncertain, setUncertain] = useState(false);
  const [paired, setPaired] = useState<SessionView | null>(null);
  // 回执不确定的那一次：同一个码和设备名再试就沿用它的标识；明确失败或改了输入就换新的。
  const attempt = useRef<PairingAttempt | null>(null);
  useEffect(clearPairingLink, []);
  useEffect(() => {
    if (invitation === null || busy || uncertain || paired !== null) return;
    const timeout = setTimeout(() => setExpired(true), Math.max(0, Date.parse(invitation.expiresAt) - Date.now()));
    return () => clearTimeout(timeout);
  }, [invitation, busy, uncertain, paired]);

  const manual = (): void => {
    setInvitation(null);
    setCode('');
    setExpired(false);
    setError(null);
    setUncertain(false);
    attempt.current = null;
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const name = deviceName.trim() === '' ? DEFAULT_DEVICE_NAME : deviceName.trim();
    const key = attemptKey(code, name);
    if (attempt.current === null || attempt.current.key !== key) {
      attempt.current = { requestId: createRequestId(), key };
    }
    const { requestId } = attempt.current;
    setBusy(true);
    setError(null);
    try {
      const session = await api.session.pair({ code: code.trim(), deviceName: name, requestId });
      attempt.current = null;
      setUncertain(false);
      if (invitation === null) onPaired(session);
      else { onSessionOpened?.(session); setPaired(session); }
    } catch (cause) {
      setUncertain(isUncertain(cause));
      if (!isUncertain(cause)) {
        attempt.current = null;
      }
      setError(errorText(cause));
      if (cause instanceof ApiError && cause.code === 'pairing_code_expired') setExpired(true);
    } finally {
      setBusy(false);
    }
  };

  const brand = <div className="login-brand"><PlasticineMark size={28} /><span>Plasticine</span></div>;
  if (paired !== null) {
    return <main className="login login-invite"><div className="login-form">
      {brand}<div className="login-result" role="status"><span className="login-success">
        <Icon name="check" size={40} /></span><h1 className="login-title">这台{phone ? '手机' : '设备'}已连接</h1>
        <p className="login-instance">{paired.device.name}</p></div>
      <button type="button" className="primary-button" onClick={() => onPaired(paired)}>打开 Plasticine</button>
    </div></main>;
  }
  if (expired) {
    return <main className="login login-invite"><div className="login-form">
      {brand}<h1 className="login-title">配对邀请已过期</h1>
      <p className="login-instance">请在原设备重新生成配对邀请。</p>
      <button type="button" className="primary-button" onClick={manual}>输入新的配对码</button>
    </div></main>;
  }
  return (
    <main className={`login${invitation === null ? '' : ' login-invite'}`}>
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        {brand}
        <h1 className="login-title">{invitation === null ? '配对这台设备' : '连接到 Plasticine'}</h1>
        <p className="login-instance">{window.location.host}</p>
        {invitation !== null ? null : <label className="field">
          <span className="field-label">配对码</span>
          <input
            className="field-input field-input-mono"
            autoCapitalize="characters"
            spellCheck={false}
            autoComplete="one-time-code"
            maxLength={PAIRING_CODE_INPUT_MAX_CHARS}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="7KQ4-M2XD"
            disabled={busy}
            required
          />
        </label>}
        <label className="field">
          <span className="field-label">{invitation === null ? '这台设备叫什么' : '设备名称'}</span>
          <input
            className="field-input"
            placeholder="例如：书房的 Mac"
            maxLength={DEVICE_NAME_MAX_CHARS}
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            disabled={busy}
          />
        </label>
        {error === null ? null : (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy || code.trim() === ''}>
          {busy ? '正在连接…' : invitation === null ? '配对' : `连接这台${phone ? '手机' : '设备'}`}
        </button>
        {busy ? <p className="login-connecting" role="status"><StatusGlyph status="run" label="正在连接" />
          正在等待连接回执</p> : null}
        {invitation === null ? <details className="login-help"><summary>在哪里获取配对码？</summary>
          <p>在已登录的设备上打开「设置 → 系统 → 设备 → 添加设备」，复制 8 位字母数字的备用码。</p>
          <p>第一次安装后，用安装器给出的登录链接打开；服务器安装可运行 <code>pairing-cli</code>。</p>
        </details> : <button type="button" className="text-button text-button-quiet login-switch"
          disabled={busy || uncertain} onClick={manual}>不是要连接这一份？</button>}
      </form>
    </main>
  );
}

function suggestedDeviceName(): string {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return '我的 iPhone';
  if (/iPad/i.test(agent)) return '我的 iPad';
  if (/Android/i.test(agent)) return '我的手机';
  if (/Macintosh/i.test(agent)) return '我的 Mac';
  if (/Windows/i.test(agent)) return '我的 Windows 电脑';
  return '这台浏览器';
}
