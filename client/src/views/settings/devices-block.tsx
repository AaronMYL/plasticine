// 设置 · 系统 ·「设备」（2026-11-05 设计稿 Settings-System）：配对过的浏览器 / 手机和 Mac App 一行一台（这台 / 上次在线），
// 行尾 ⋯ 收撤销和退出；「添加设备」打开浏览器登录邀请，Mac 执行节点保留在展开项，两种码不通用。
// 撤销和退出收不回：点了先常显后果，再点「确定」才做。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { DeviceView, NodeView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { useStore } from '../../state/use-store.ts';
import { SectionHead } from './section-head.tsx';
import { Failure, useRead } from './system-read.tsx';
import { DevicePairingSheet } from './device-pairing-sheet.tsx';

type Confirm =
  | { kind: 'logout' }
  | { kind: 'revoke'; device: DeviceView }
  | { kind: 'node'; node: NodeView };

const CONSEQUENCES: Readonly<Record<Confirm['kind'], string>> = {
  logout: '退出后要在另一台已登录的设备上拿配对码才能回来。',
  revoke: '撤销后那台要重新配对。',
  node: '撤销后这台 Mac 不再替你做设备上的事，要重新配对。',
};

const CONFIRM_LABELS: Readonly<Record<Confirm['kind'], string>> = {
  logout: '确定退出',
  revoke: '确定撤销',
  node: '确定撤销',
};

function confirmTitle(confirm: Confirm): string {
  switch (confirm.kind) {
    case 'logout': return '退出这台';
    case 'revoke': return `撤销「${confirm.device.name}」`;
    case 'node': return `撤销「${confirm.node.name}」`;
  }
}

export function Devices(): ReactNode {
  const api = useApi();
  const live = useLive();
  const devices = useRead<DeviceView[]>((signal) => api.devices.list(signal), [api]);
  const nodes = useStore(live.devices.nodes);
  const [pairOpen, setPairOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = new Date();
  const sessions = (devices.value ?? []).filter((device) => device.revokedAt === null);
  const macs = (nodes.value?.nodes ?? []).filter((node) => node.revokedAt === null);
  const run = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(null);
    action().then(() => setConfirm(null), (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };
  const perform = (current: Confirm): void => run(async () => {
    switch (current.kind) {
      case 'logout':
        await api.session.logout();
        window.dispatchEvent(new Event('plasticine:logout'));
        return;
      case 'revoke':
        await api.devices.revoke(current.device.id);
        devices.reload();
        return;
      case 'node':
        await live.deviceWrites.revoke(current.node);
        return;
    }
  });
  const sessionActions = (device: DeviceView) => [device.current
    ? { icon: 'close' as const, label: '退出这台', onSelect: () => setConfirm({ kind: 'logout' }) }
    : { icon: 'close' as const, label: '撤销', onSelect: () => setConfirm({ kind: 'revoke', device }) }];
  return (
    <section className="block" aria-labelledby="settings-devices">
      <SectionHead id="settings-devices" title="设备">
        <span className="system-head-gap" />
        <button type="button" className="chip-button" onClick={() => setPairOpen(true)}>
          <Icon name="plus" size={14} />添加设备
        </button>
      </SectionHead>
      {devices.value === null && devices.error === null ? <p className="block-empty" role="status">正在读取设备…</p> : null}
      {devices.value !== null && sessions.length === 0 && macs.length === 0
        ? <p className="block-empty">还没有连接的设备。</p> : null}
      {devices.error === null ? null : <Failure error={devices.error} onReload={devices.reload} />}
      <ul className="system-rows" aria-label="已配对的设备">
        {sessions.map((device) => (
          <li key={device.id} className="system-row">
            <Icon name={/iphone|手机|phone/i.test(device.name) ? 'phone' : 'mac'} />
            <span className="system-row-title">{device.name}</span>
            {device.current ? <span className="system-row-meta"><span className="dot dot-ok" aria-hidden="true" />这台
            </span> : <span className="system-row-meta">{relativeTime(device.lastSeenAt, now)}</span>}
            <RevealMore label={`「${device.name}」的更多操作`} actions={sessionActions(device)} />
          </li>
        ))}
        {macs.map((node) => (
          <li key={node.id} className="system-row">
            <Icon name="mac" />
            <span className="system-row-title">{node.name} · Mac App</span>
            <span className="system-row-meta">{relativeTime(node.lastSeenAt, now)}</span>
            <RevealMore label={`「${node.name}」的更多操作`} actions={[{ icon: 'close', label: '撤销',
              onSelect: () => setConfirm({ kind: 'node', node }) }]} />
          </li>
        ))}
      </ul>
      {confirm === null ? null : (
        <div className="settings-confirm" role="alertdialog" aria-label={confirmTitle(confirm)}>
          <span className="settings-confirm-text">{CONSEQUENCES[confirm.kind]}</span>
          <button type="button" className="text-button text-button-quiet" disabled={busy}
            onClick={() => setConfirm(null)}>取消</button>
          <button type="button" className="primary-button button-small" disabled={busy}
            onClick={() => perform(confirm)}>{CONFIRM_LABELS[confirm.kind]}</button>
        </div>
      )}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {pairOpen ? <DevicePairingSheet onClose={() => setPairOpen(false)} onConnected={devices.reload} /> : null}
    </section>
  );
}
