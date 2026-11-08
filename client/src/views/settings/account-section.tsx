// 设置 · 账号 · 「这台设备」（用户视角审查 2026-11-01 第 15 条；2026-11-05 从「常用」挪到「账号」）：这台设备的名字
// （api.session.current()）、「退出这台浏览器」带就地确认（和 device/browser-sessions.tsx 同一套：确定退出 / 取消 +
// 一句为什么要确认）、「管理已配对的设备 →」到「系统」那一段。退出成功后发 plasticine:logout，壳回到配对页。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { useClientState } from '../../state/context.tsx';
import { useGoToSettings } from './settings-dialog-context.ts';

export function AccountSection(): ReactNode {
  const api = useApi();
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goTo = useGoToSettings();
  const { deviceUi } = useClientState();
  useEffect(() => {
    const controller = new AbortController();
    void api.session.current(controller.signal).then((session) => {
      if (controller.signal.aborted) { return; }
      setDeviceName(session === null ? null : session.device.name);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) { setReadError(errorText(cause)); }
    });
    return () => controller.abort();
  }, [api]);
  const logout = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.session.logout();
      window.dispatchEvent(new Event('plasticine:logout'));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return <section className="block" aria-labelledby="settings-account">
    <header className="block-head"><h3 id="settings-account" className="block-title">这台设备</h3></header>
    <p className="settings-device">
      {deviceName === null ? (readError === null ? '正在读…' : '没读到') : <strong>{deviceName}</strong>}
    </p>
    {readError === null ? null : <p className="block-empty is-error" role="alert">{readError}</p>}
    {goTo === null ? <a className="text-button settings-device-link" href="#/device">管理已配对的设备 →</a>
      : <button type="button" className="text-button settings-device-link"
        onClick={() => { deviceUi.setTab('devices'); goTo('system'); }}>管理已配对的设备 →</button>}
    {confirming ? <div className="settings-confirm" role="group" aria-label="确认退出">
      <span className="text-meta">退出后要在另一台已登录的设备上拿配对码才能回来。</span>
      <button type="button" className="chip-button" disabled={busy} onClick={() => void logout()}>
        {busy ? '正在退出…' : '确定退出'}
      </button>
      <button type="button" className="text-button" disabled={busy} onClick={() => setConfirming(false)}>取消</button>
    </div> : <button type="button" className="text-button settings-logout" disabled={busy}
      onClick={() => setConfirming(true)}>退出这台浏览器</button>}
    {error === null ? null : <p className="block-empty is-error" role="alert">退出没有成功：{error}</p>}
  </section>;
}
