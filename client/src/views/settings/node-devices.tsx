// 设置 · 系统 ·「替你动手的电脑」：还连着的旧 Mac App 执行节点一行一台，⋯ 里撤销（先常显后果再确定）。
// 11-08 去掉配对码后不再从这里添加（桌面客户端在「让 Plasticine 用这台电脑」里自己配）；一台都没有时整段不出现。

import { useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { NodeView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { useStore } from '../../state/use-store.ts';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';
import { timeText } from '../../shell/time-text.ts';

/** 这台电脑是什么：Mac 和 Windows 的桌面客户端是同一套，都列在这里。 */
const PLATFORM_NAMES: Readonly<Partial<Record<NodeView['platform'], string>>> = { macos: 'Mac', windows: 'Windows',
  linux: 'Linux' };

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
            name={`${node.name} · ${PLATFORM_NAMES[node.platform] ?? '电脑'}`} sub={timeText(node.lastSeenAt, now)}>
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
