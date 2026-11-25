import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { BackupList, SystemOperations } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { fileSize } from '../../primitives/artifact-card/format.ts';
import { formatClock } from '../../primitives/message/states.ts';
import { Backups } from '../device/backups.tsx';
import { choiceName } from '../models/model-store.ts';
import { CalendarAccess } from './calendar-access.tsx';
import { MigrationBlock } from './migration-section.tsx';
import { DesktopComputer } from './desktop-computer.tsx';
import { DesktopPlace } from './desktop-place.tsx';
import { NodeDevices } from './node-devices.tsx';
import { desktopShell, useDesktopState } from './desktop-shell.ts';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';
import { Failure, useRead } from './system-read.tsx';
import { timeText } from '../../shell/time-text.ts';

const OPERATIONS_POLL_MS = 30_000;
const BACKUP_ROWS = 3;

function uptimeText(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3600) % 24;
  return days > 0 ? `${days} 天 ${hours} 小时` : `${hours} 小时 ${Math.floor(seconds / 60) % 60} 分钟`;
}

function Running({ value, error, onReload }: { value: SystemOperations | null; error: string | null;
  onReload: () => void }): ReactNode {
  const live = useLive();
  const timeZone = useTimeZone();
  const models = useStore(live.models.store);
  const clock = (at: string | null): string => (at === null ? '—' : formatClock(at, false, timeZone));
  const gb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);
  const facts: Array<[string, ReactNode]> = value === null ? [] : [
    ['已运行', uptimeText(value.uptimeSeconds)],
    ['模型', choiceName(models.value) ?? '没连上'],
    ['磁盘', <>剩余 <span className="mono">{gb(value.diskFreeBytes)}</span> / <span className="mono">
      {gb(value.diskTotalBytes)}</span> GB</>],
    ['邮件', <>收到 <span className="mono">{clock(value.mail.receivedAt)}</span> · 发出 <span className="mono">
      {clock(value.mail.sentAt)}</span></>],
  ];
  return (
    <section className="block" aria-labelledby="settings-running">
      <SectionHead id="settings-running" title="运行情况" />
      {error === null ? null : <Failure error={error} onReload={onReload} />}
      {value?.diskLow === true ? <p className="system-warn" role="alert">磁盘可用空间不足 1 GB，清一清不要的文件。</p>
        : null}
      {value?.mail.sendError == null ? null : <p className="system-warn" role="alert">发信出错：{value.mail.sendError}</p>}
      {facts.map(([label, text]) => (
        <SettingRow key={label} name={label}><span className="set-row-value">{text}</span></SettingRow>
      ))}
    </section>
  );
}

function BackupBlock(): ReactNode {
  const api = useApi();
  const live = useLive();
  const timeZone = useTimeZone();
  const list = useRead<BackupList>((signal) => api.backups.list(signal), [api]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'backups.changed') list.reload();
  }), [live.hub]);
  const rows = (list.value?.backups ?? []).slice(0, BACKUP_ROWS);
  const now = new Date();
  const backupNow = (): void => {
    setBusy(true);
    api.backups.create({ requestId: createRequestId() }).then(() => {
      setBusy(false);
      list.reload();
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  return (
    <section className="block" aria-labelledby="settings-backups">
      <SectionHead id="settings-backups" title="备份" />
      {list.error === null ? null : <Failure error={list.error} onReload={list.reload} />}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <SettingRow name="现在备份一份" sub={list.value?.schedule}>
        <button type="button" className="secondary-button" disabled={busy} onClick={backupNow}>现在备份</button>
      </SettingRow>
      <ul className="account-rows" aria-label="最近的备份">
        {rows.map((row) => (
          <SettingRow key={row.id} as="li" className="system-backup" name={<>{timeText(row.createdAt, now)}{' '}
            <span className="mono">{formatClock(row.createdAt, false, timeZone)}</span></>}
          lead={<span className="system-backup-mark" data-status={row.status}>
            <Icon name={row.status === 'ready' ? 'check' : row.status === 'failed' ? 'alert' : 'clock'} size={16} />
          </span>}>
            <span className="set-row-value mono">{fileSize(row.bytes)}</span>
          </SettingRow>
        ))}
      </ul>
      <Backups trigger />
    </section>
  );
}

function DesktopBlocks(): ReactNode {
  const shell = desktopShell();
  const [state, change] = useDesktopState(shell);
  if (shell === null) {
    return null;
  }
  return (
    <>
      {state.server === null ? null
        : <DesktopPlace shell={shell} status={state.server} onStatus={(server) => change({ server })} />}
      <DesktopComputer shell={shell} state={state} onChange={change} />
      {state.error === null ? null : <p className="block-empty is-error" role="alert">{state.error}</p>}
    </>
  );
}

export function SystemSection(): ReactNode {
  const api = useApi();
  const operations = useRead<SystemOperations>((signal) => api.systems.operations(signal), [api],
    OPERATIONS_POLL_MS);
  const desktop = desktopShell() !== null;
  return (
    <>
      {desktop ? <><DesktopBlocks /><CalendarAccess /></> : null}
      <Running value={operations.value} error={operations.error} onReload={operations.reload} />
      <NodeDevices />
      {desktop ? null : <CalendarAccess />}
      <BackupBlock />
      <MigrationBlock />
    </>
  );
}
