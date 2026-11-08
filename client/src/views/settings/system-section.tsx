// 设置 · 系统（2026-11-05 设计稿 Settings-System）：去掉启用 / 验收、度量、自迭代策略 / 记录之后剩下的四块——
//   版本      有新版本时一行：新版本 · 现在 ·「更新并重启」（后果常显：会重启约 1 分钟，在做的线重启后接着做）；
//   运行情况  已运行 · 模型 · 磁盘 · 邮件（两列）；
//   替你动手的电脑  还连着的旧 Mac App 执行节点（node-devices.tsx）；登录着的设备 11-08 挪到 设置 · 账号，
//             「添加设备」（配对码、二维码、Mac 专用码）随配对码一起去掉；
//   日历和提醒事项  他 Mac 给没给完全访问，「去授权」（calendar-access.tsx，第 15 条）；
// 在桌面客户端（Electron 壳）里最上面另有「Plasticine 跑在哪」「这台电脑」两段（desktop-place.tsx、
// desktop-computer.tsx，第 14 条），日历和提醒事项挪到它们后面，和这台电脑的事放在一起。
//   备份      每天几点 ·「现在备份」，最近几份一行一份，「全部备份」开按对象恢复。

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { BackupList, ClientUpdatesResponse, SystemOperations } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { relativeTime } from '../../shell/relative-time.ts';
import { useStore } from '../../state/use-store.ts';
import { fileSize } from '../../primitives/artifact-card/format.ts';
import { formatClock } from '../../primitives/message/states.ts';
import { Backups } from '../device/backups.tsx';
import { choiceName } from '../models/model-store.ts';
import { CalendarAccess } from './calendar-access.tsx';
import { DesktopComputer } from './desktop-computer.tsx';
import { DesktopPlace } from './desktop-place.tsx';
import { NodeDevices } from './node-devices.tsx';
import { desktopShell, useDesktopState } from './desktop-shell.ts';
import { SectionHead } from './section-head.tsx';
import { Failure, useRead } from './system-read.tsx';

/** 运行概况隔多久再读一次（和原来的系统页一样）。 */
const OPERATIONS_POLL_MS = 30_000;
/** 备份一段列最近几份。 */
const BACKUP_ROWS = 3;

function Version({ operations }: { operations: SystemOperations | null }): ReactNode {
  const api = useApi();
  const updates = useRead<ClientUpdatesResponse>((signal) => api.clientUpdates.list(signal), [api]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = updates.value?.updates.find((item) => item.status === 'candidate' || item.status === 'queued');
  if (next === undefined) {
    return null;
  }
  const update = (): void => {
    setBusy(true);
    api.clientUpdates.decide(next.manifest.buildId, { requestId: createRequestId(),
      currentBuildId: updates.value?.current?.buildId ?? null, targetBuildId: next.manifest.buildId,
      decision: 'publish' }).then(() => {
      setBusy(false);
      updates.reload();
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  return (
    <section className="block" aria-labelledby="settings-version">
      <SectionHead id="settings-version" title="版本" />
      <div className="system-update">
        <span className="system-update-text">
          <span>有新版本 <span className="mono">{next.manifest.buildId}</span>
            {operations?.version == null ? null : <span className="text-meta">　现在 <span className="mono">
              {operations.version}</span></span>}</span>
          <span className="text-meta">更新时会重启，约 1 分钟；在做的线重启后接着做</span>
        </span>
        <button type="button" className="primary-button" disabled={busy || next.status === 'queued'}
          onClick={update}>{next.status === 'queued' ? '在更新' : '更新并重启'}</button>
      </div>
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
    </section>
  );
}

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
    ['磁盘', <>剩 <span className="mono">{gb(value.diskFreeBytes)}</span> / <span className="mono">
      {gb(value.diskTotalBytes)}</span> GB</>],
    ['邮件', <>收 <span className="mono">{clock(value.mail.receivedAt)}</span> · 发 <span className="mono">
      {clock(value.mail.sentAt)}</span></>],
  ];
  return (
    <section className="block" aria-labelledby="settings-running">
      <SectionHead id="settings-running" title="运行情况" />
      {error === null ? null : <Failure error={error} onReload={onReload} />}
      {value?.diskLow === true ? <p className="system-warn" role="alert">磁盘可用空间不足 1 GB，清一清不要的文件。</p>
        : null}
      {value?.mail.sendError == null ? null : <p className="system-warn" role="alert">发信出错：{value.mail.sendError}</p>}
      <dl className="system-facts">
        {facts.map(([label, text]) => (
          <Fragment key={label}><dt>{label}</dt><dd>{text}</dd></Fragment>
        ))}
      </dl>
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
      <SectionHead id="settings-backups" title="备份">
        <span className="system-head-gap" />
        {list.value === null ? null : <span className="block-meta text-meta">{list.value.schedule}</span>}
        <button type="button" className="secondary-button button-small" disabled={busy} onClick={backupNow}>
          现在备份</button>
      </SectionHead>
      {list.error === null ? null : <Failure error={list.error} onReload={list.reload} />}
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <ul className="system-rows">
        {rows.map((row) => (
          <li key={row.id} className="system-row" data-status={row.status}>
            {row.status === 'ready' ? <span className="system-ok"><Icon name="check" size={15} /></span>
              : <span className="system-row-icon"><Icon name={row.status === 'failed' ? 'alert' : 'clock'} size={15} />
              </span>}
            <span className="system-row-title">{relativeTime(row.createdAt, now)} <span className="mono">
              {formatClock(row.createdAt, false, timeZone)}</span></span>
            <span className="system-row-meta mono">{fileSize(row.bytes)}</span>
          </li>
        ))}
      </ul>
      <Backups trigger />
    </section>
  );
}

/** 桌面客户端里（Electron 壳）才有的几段：跑在哪、这台电脑；日历和提醒事项跟在这台电脑后面。 */
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
      <Version operations={operations.value} />
      <Running value={operations.value} error={operations.error} onReload={operations.reload} />
      <NodeDevices />
      {desktop ? null : <CalendarAccess />}
      <BackupBlock />
    </>
  );
}
