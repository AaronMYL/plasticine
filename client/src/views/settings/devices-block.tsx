import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { DeviceView } from '../../api/shared.ts';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { Icon } from '../../shell/icons.tsx';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';
import './account-profile.css';
import { Failure, useRead } from './system-read.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { timeText } from '../../shell/time-text.ts';

type Confirm = { kind: 'logout' } | { kind: 'revoke'; device: DeviceView };

const PHONE_NAME = /iphone|ipad|android|安卓|手机|phone/i;

function deviceLabel(device: DeviceView): string {
  return device.local === true ? '这台电脑' : device.name;
}

const VIA_LABEL: Readonly<Record<NonNullable<DeviceView['via']>, string>> = {
  local: '本机', direct: '直连', relay: '经中继', web: '自己的网址',
};

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
      <SectionHead id="settings-devices" title="登录着的设备"
        tip="经 Cyber Hunter 网络连进来的设备，能直连就直连，打不通走中继，自动切换。" />
      {devices.value === null && devices.error === null ? <PageLoading rows={2} dense /> : null}
      {devices.error === null ? null : <Failure error={devices.error} onReload={devices.reload} />}
      <ul className="account-rows account-devices" aria-label="登录着的设备">
        {rows.map((device) => (
          <SettingRow key={device.id} as="li" name={deviceLabel(device)}
            sub={`${device.current ? '这台 · ' : ''}${timeText(device.lastSeenAt, now)}`}
            lead={<Icon name={device.local !== true && PHONE_NAME.test(device.name) ? 'phone' : 'mac'} />}>
            {device.via === undefined ? null : (
              <span className="account-device-via" data-via={device.via}>
                <span className="account-device-dot" aria-hidden="true" />{VIA_LABEL[device.via]}
              </span>
            )}
            {device.current ? (
              <button type="button" className="secondary-button" onClick={() => setConfirm({ kind: 'logout' })}>
                退出这台</button>
            ) : (
              <button type="button" className="secondary-button" disabled={busy}
                aria-label={`让「${deviceLabel(device)}」退出`}
                onClick={() => setConfirm({ kind: 'revoke', device })}>退出</button>
            )}
          </SettingRow>
        ))}
      </ul>
      {confirm === null ? null : (
        <ConfirmDialog title={confirm.kind === 'logout' ? '退出这台？' : `让「${deviceLabel(confirm.device)}」退出？`}
          body={confirmText(confirm)} confirmLabel="退出" busy={busy} error={error}
          onCancel={() => {
            setConfirm(null);
            setError(null);
          }} onConfirm={() => perform(confirm)} />
      )}
      {error === null || confirm !== null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
    </section>
  );
}
