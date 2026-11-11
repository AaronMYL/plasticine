// 设置 · 账号 ·「登录着的设备」（11-08 设计稿 Settings-Account）：用 @账号和密码登录着的设备一行一台——图标、名字、
// 上次在线；这台标「这台」，别的行尾「退出」。11-08 去掉配对码：不再有「添加设备」（新设备直接用 @账号和密码登录）。
// 退出别的设备、退出这台都收不回：点了先常显后果，再点「确定」才做。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { DeviceView } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { SectionHead } from './section-head.tsx';
import './account-profile.css';
import { Failure, useRead } from './system-read.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

type Confirm = { kind: 'logout' } | { kind: 'revoke'; device: DeviceView };

const PHONE_NAME = /iphone|ipad|android|安卓|手机|phone/i;

/** 桌面客户端替本机界面登录的那台（DeviceView.local）写「这台电脑」，别的写登记时的名字。 */
function deviceLabel(device: DeviceView): string {
  return device.local === true ? '这台电脑' : device.name;
}

function confirmText(confirm: Confirm): string {
  return confirm.kind === 'logout' ? '退出后要用 @账号和密码重新登录。'
    : `「${deviceLabel(confirm.device)}」会退出，要用 @账号和密码重新登录。`;
}

export function Devices(): ReactNode {
  const api = useApi();
  const devices = useRead<DeviceView[]>((signal) => api.devices.list(signal), [api]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const rows = (devices.value ?? []).filter((device) => device.revokedAt === null)
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt));
  const perform = (current: Confirm): void => {
    setBusy(true);
    setError(null);
    const action = current.kind === 'logout'
      ? api.session.logout().then(() => { window.dispatchEvent(new Event('plasticine:logout')); })
      : api.devices.revoke(current.device.id).then(() => { devices.reload(); });
    action.then(() => setConfirm(null), (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="block" aria-labelledby="settings-devices">
      <SectionHead id="settings-devices" title="登录着的设备" />
      {devices.value === null && devices.error === null ? <PageLoading rows={2} dense /> : null}
      {devices.error === null ? null : <Failure error={devices.error} onReload={devices.reload} />}
      <ul className="system-rows account-devices" aria-label="登录着的设备">
        {rows.map((device) => (
          <li key={device.id} className="system-row">
            <Icon name={device.local !== true && PHONE_NAME.test(device.name) ? 'phone' : 'mac'} />
            <span className="account-device-main">
              <span className="system-row-title">{deviceLabel(device)}</span>
              <span className="text-meta account-device-meta">{relativeTime(device.lastSeenAt, now)}</span>
            </span>
            {device.current ? <span className="system-row-meta">这台</span> : (
              <button type="button" className="secondary-button button-small" disabled={busy}
                aria-label={`让「${deviceLabel(device)}」退出`}
                onClick={() => setConfirm({ kind: 'revoke', device })}>退出</button>
            )}
          </li>
        ))}
      </ul>
      {rows.some((device) => device.current) && confirm === null ? (
        <button type="button" className="text-button text-button-quiet account-logout"
          onClick={() => setConfirm({ kind: 'logout' })}>退出这台</button>
      ) : null}
      {confirm === null ? null : (
        <div className="settings-confirm" role="alertdialog"
          aria-label={confirm.kind === 'logout' ? '退出这台' : `让「${deviceLabel(confirm.device)}」退出`}>
          <span className="settings-confirm-text">{confirmText(confirm)}</span>
          <button type="button" className="text-button text-button-quiet" disabled={busy}
            onClick={() => setConfirm(null)}>取消</button>
          <button type="button" className="primary-button button-small" disabled={busy}
            onClick={() => perform(confirm)}>确定退出</button>
        </div>
      )}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
    </section>
  );
}
