// 设置 · 系统「数据迁移」一块（11-16 设计稿第 1 块，Aaron 选「可以做」）：备份下面，设置页那一种行。
//   导出      打成一个文件带走 ·「导出…」；打包时写进度能取消；好了「下载」，24 小时后从这台删掉
//   从另一台导入  合并或替换 ·「选文件…」：选完马上传，弹框里走完（migration-import-dialog.tsx）
//   导入前的数据  导入过才有：哪天留的、哪天删 ·「退回…」
// 有事在做时一秒问一次，没事半分钟一次。

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import {
  MIGRATION_FILE_EXTENSION, type MigrationHow, type MigrationImportView, type MigrationMode, type MigrationStatus,
} from '../../api/shared.ts';
import { useTimeZone } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { MigrationExportDialog } from './migration-export-dialog.tsx';
import { MigrationImportDialog } from './migration-import-dialog.tsx';
import { RestartCover, type RestartKind } from './migration-restart.tsx';
import { dayText, sizeText, stampText } from './migration-text.ts';
import { SectionHead } from './section-head.tsx';
import { SettingRow } from './setting-row.tsx';
import './migration.css';

const BUSY_POLL_MS = 1_000;
const IDLE_POLL_MS = 30_000;

function busyNow(status: MigrationStatus | null): boolean {
  const state = status?.import?.state;
  return status?.export?.state === 'running' || state === 'staging' || state === 'applying';
}

function ExportRow({ status, timeZone, onOpen, onCancel, url }: { status: MigrationStatus | null; timeZone: string;
  onOpen: () => void; onCancel: () => void; url: string }): ReactNode {
  const job = status?.export ?? null;
  if (job?.state === 'running') {
    const fraction = job.totalBytes === 0 ? 0 : job.doneBytes / job.totalBytes;
    return (
      <SettingRow name="导出" sub={<>
        正在打包（{job.mode === 'full' ? '全部' : '只有数据'}）· <span className="mono">{sizeText(job.doneBytes)} / 约{' '}
          {sizeText(job.totalBytes)}</span>
        <span className="mig-bar mig-row-bar" role="progressbar" aria-label="打包进度" aria-valuemin={0}
          aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
          <i style={{ width: `${(fraction * 100).toFixed(1)}%` }} /></span>
      </>}>
        <button type="button" className="text-button" onClick={onCancel}>取消</button>
      </SettingRow>
    );
  }
  if (job?.state === 'ready' && job.fileName !== null) {
    return (
      <SettingRow name="导出" sub={<>
        <span className="mono">{stampText(job.createdAt, timeZone)}</span> · {job.mode === 'full' ? '全部，口令加密'
          : <>只有数据，<span className="set-row-error">没加密</span></>} · <span className="mono">
          {sizeText(job.fileBytes ?? 0)}</span> · 24 小时后从这台删除
      </>}>
        <a className="primary-button" href={url} download={job.fileName}><Icon name="download" size={14} />下载</a>
        <button type="button" className="secondary-button" onClick={onOpen}>再导出…</button>
      </SettingRow>
    );
  }
  return (
    <SettingRow name="导出"
      sub={job?.state === 'failed' ? <span className="set-row-error">{job.error}</span>
        : '打成一个文件带走：只要数据，或者连密钥和地址一起'}>
      <button type="button" className="secondary-button" onClick={onOpen}>导出…</button>
    </SettingRow>
  );
}

export function MigrationBlock(): ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'export' | 'import' | 'undo' | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  /** 正在传的那份（服务端还没回之前先这样显示）。 */
  const [uploading, setUploading] = useState<MigrationImportView | null>(null);
  const [restart, setRestart] = useState<{ kind: RestartKind; since: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | null>(null);
  const read = useCallback((): void => {
    api.migration.status().then((next) => {
      setStatus(next);
      setError(null);
    }, (cause: unknown) => setError(errorText(cause)));
  }, [api]);
  useEffect(() => {
    read();
    const timer = setInterval(read, busyNow(status) || dialog === 'import' ? BUSY_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [read, status?.export?.state, status?.import?.state, dialog]);
  const act = (work: Promise<MigrationStatus>, after?: (next: MigrationStatus) => void): void => {
    setBusy(true);
    setDialogError(null);
    work.then((next) => {
      setStatus(next);
      after?.(next);
    }, (cause: unknown) => setDialogError(errorText(cause))).finally(() => setBusy(false));
  };
  const startExport = (mode: MigrationMode, passphrase: string | null): void => {
    act(api.migration.startExport(mode, passphrase), () => setDialog(null));
  };
  const pick = (file: File): void => {
    const controller = new AbortController();
    upload.current = controller;
    setDialog('import');
    setDialogError(null);
    setProgress(0);
    setUploading({ id: 'local', name: file.name, state: 'uploading', bytes: file.size, received: 0, mode: null,
      encrypted: null, summary: null, stagedBytes: 0, how: null, error: null, errorCode: null });
    api.migration.upload(file, file.name, setProgress, controller.signal).then((next) => {
      setStatus(next);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setDialogError(errorText(cause));
    }).finally(() => {
      setProgress(null);
      setUploading(null);
    });
  };
  const cancelImport = (): void => {
    upload.current?.abort();
    upload.current = null;
    setProgress(null);
    setUploading(null);
    setDialog(null);
    setDialogError(null);
    void api.migration.cancelImport().then(setStatus, () => undefined);
  };
  const apply = (how: MigrationHow): void => {
    setBusy(true);
    setDialogError(null);
    api.migration.apply(how).then((answer) => {
      setStatus(answer.status);
      setDialog(null);
      setRestart({ kind: how, since: Date.now() });
    }, (cause: unknown) => setDialogError(errorText(cause))).finally(() => setBusy(false));
  };
  const undo = (): void => {
    setBusy(true);
    setDialogError(null);
    api.migration.undo().then(() => {
      setDialog(null);
      setRestart({ kind: 'undo', since: Date.now() });
    }, (cause: unknown) => setDialogError(errorText(cause))).finally(() => setBusy(false));
  };
  const failed = useCallback((view: MigrationImportView): void => {
    setRestart(null);
    setStatus((current) => current === null ? current : { ...current, import: view });
    setDialog('import');
  }, []);
  const view = uploading ?? status?.import ?? null;
  const before = status?.before ?? null;
  return (
    <section className="block" aria-labelledby="settings-migration">
      <SectionHead id="settings-migration" title="数据迁移" />
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      <ExportRow status={status} timeZone={timeZone} url={api.migration.exportUrl()} onOpen={() => {
        setDialogError(null);
        setDialog('export');
      }} onCancel={() => act(api.migration.cancelExport())} />
      <SettingRow name="从另一台导入"
        sub="合并进来，或者整个替换；导入前在这台留一份，7 天内能退回">
        <button type="button" className="secondary-button" onClick={() => picker.current?.click()}>选文件…</button>
        <input ref={picker} type="file" hidden accept={MIGRATION_FILE_EXTENSION} aria-label="选迁移文件"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file !== undefined) pick(file);
          }} />
      </SettingRow>
      {before === null ? null : (
        <SettingRow name="导入前的数据" sub={<>
          <span className="mono">{stampText(before.at, timeZone)}</span> {before.how === 'merge' ? '合并' : '替换'}前留的一份
          · <span className="mono">{dayText(before.expiresAt, timeZone)}</span> 删除</>}>
          <button type="button" className="secondary-button" onClick={() => {
            setDialogError(null);
            setDialog('undo');
          }}>退回…</button>
        </SettingRow>
      )}
      {dialog === 'export' ? <MigrationExportDialog busy={busy} error={dialogError} onStart={startExport}
        onClose={() => setDialog(null)} /> : null}
      {dialog === 'import' && view !== null && restart === null ? <MigrationImportDialog view={view}
        progress={progress} busy={busy} error={dialogError}
        onUnlock={(passphrase) => act(api.migration.unlock(passphrase))} onApply={apply}
        onCancel={cancelImport} /> : null}
      {dialog === 'undo' && before !== null ? <ConfirmDialog title="退回到导入前？" tone="danger"
        body={`这台会回到 ${stampText(before.at, timeZone)} 导入前的样子，之后的改动都不要了；Plasticine 会重启。`}
        confirmLabel="退回并重启" busy={busy} error={dialogError} onConfirm={undo}
        onCancel={() => setDialog(null)} /> : null}
      {restart === null ? null : <RestartCover kind={restart.kind} since={restart.since} onFailed={failed} />}
    </section>
  );
}
