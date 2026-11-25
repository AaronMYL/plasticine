import { useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { DEVICE_KIND_LABELS, type NodeView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { useStore } from '../../state/use-store.ts';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';
import { timeText } from '../../shell/time-text.ts';

const PLATFORM_NAMES: Readonly<Partial<Record<NodeView['platform'], string>>> = { macos: 'Mac', windows: 'Windows',
  linux: 'Linux' };

const MINUTE_MS = 60_000;
const OFFLINE_AFTER_MS = 150_000;

export function nodeStatusText(node: NodeView, now: Date): string {
  if (!node.online || now.getTime() - Date.parse(node.lastSeenAt) > OFFLINE_AFTER_MS) {
    return `离线 · ${timeText(node.lastSeenAt, now)}`;
  }
  const { work } = node;
  if (work.state === 'idle' || work.kind === null) {
    return `在线 · ${timeText(node.lastSeenAt, now)}`;
  }
  const what = `${DEVICE_KIND_LABELS[work.kind]}${work.step === null ? '' : `（${work.step}）`}`;
  if (work.state === 'stuck') {
    const minutes = work.since === null ? 0
      : Math.max(1, Math.round((now.getTime() - Date.parse(work.since)) / MINUTE_MS));
    return `卡住了 · ${what} · ${minutes} 分钟`;
  }
  return `在做 · ${what}`;
}

export function NodeDevices(): ReactNode {
  const live = useLive();
  const nodes = useStore(live.devices.nodes);
  const [confirm, setConfirm] = useState<NodeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const macs = (nodes.value?.nodes ?? []).filter((node) => node.revokedAt === null);
  if (macs.length === 0) {
    return null;
  }
  const now = new Date();
  const revoke = (node: NodeView): void => {
    setBusy(true);
    setError(null);
    live.deviceWrites.revoke(node).then(() => setConfirm(null), (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="block" aria-labelledby="settings-nodes">
      <SectionHead id="settings-nodes" title="替你动手的电脑" />
      <ul className="account-rows" aria-label="替你动手的电脑">
        {macs.map((node) => (
          <SettingRow key={node.id} as="li" lead={<Icon name="mac" />}
            name={`${node.name} · ${PLATFORM_NAMES[node.platform] ?? '电脑'}`} sub={nodeStatusText(node, now)}>
            <RevealMore label={`「${node.name}」的更多操作`} actions={[{ icon: 'close', label: '撤销',
              onSelect: () => setConfirm(node) }]} />
          </SettingRow>
        ))}
      </ul>
      {confirm === null ? null : (
        <ConfirmDialog title={`撤销「${confirm.name}」？`} body="撤销后这台电脑不再替你做设备上的事。"
          confirmLabel="撤销" busy={busy} error={error} onConfirm={() => revoke(confirm)}
          onCancel={() => {
            setConfirm(null);
            setError(null);
          }} />
      )}
      {error === null || confirm !== null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
    </section>
  );
}
