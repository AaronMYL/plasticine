import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { BackupList, BackupDetail, BackupObject } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { operationErrorText } from '../../primitives/task-row/op-line.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { useOpenPanel } from '../../shell/panel.ts';
import type { ActionRequest } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { BACKUP_KIND, backupCountLabel } from './backup-labels.ts';
import { localTime } from './format.ts';
import { fileSize } from '../../primitives/artifact-card/format.ts';
import './backups.css';
const STATUS = {
  queued: '排队',
  running: '生成并校验',
  ready: '可校验恢复',
  partial: '原件不全，仅供核对',
  failed: '失败',
  expired: '已到保留期',
};
type Request = Extract<ActionRequest, { kind: 'backup_create' | 'backup_preview' }>;
/** trigger：设置 · 系统里只放一个「全部备份」的按钮（列表在那一段自己画），点了开同一张按对象恢复的表。 */
export function Backups({ trigger = false }: { trigger?: boolean }): ReactNode {
  const api = useApi();
  const live = useLive();
  const timeZone = useTimeZone();
  const state = useClientState();
  const openPanel = useOpenPanel();
  const phone = useViewportWidth() < PHONE_BELOW;
  const operations = useStore(state.actionOps.store).filter((op) => op.key.startsWith('backup:'));
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<BackupList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BackupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((old) => old + 1);
  useEffect(
    () =>
      live.hub.on((event) => {
        if (event.type === 'resync' || event.type === 'backups.changed') {
          refresh();
        }
      }),
    [live],
  );
  useEffect(() => {
    const controller = new AbortController();
    void api.backups.list(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setList(value);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      },
    );
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => {
    if (selected === null || !open) {
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    void api.backups.get(selected, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setDetail(value);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      },
    );
    return () => controller.abort();
  }, [api, open, selected, revision]);
  const run = async (key: string, build: (requestId: string) => Request) => {
    const request = state.actionOps.begin(key, '本机备份', '备份与恢复', build, createRequestId);
    try {
      if (request.kind === 'backup_create') {
        await api.backups.create(request.body);
      } else if (request.kind === 'backup_preview') {
        const preview = await api.backups.preview(request.backupId, request.body);
        setOpen(false);
        openPanel({ kind: 'backup_restore', id: preview.id });
      } else {
        throw new Error('备份操作类型不匹配。');
      }
      state.actionOps.succeed(key);
    } catch (cause) {
      state.actionOps.fail(key, cause);
    }
    refresh();
  };
  const preview = (item: BackupObject) => {
    if (selected === null) {
      return;
    }
    void run(`backup:preview:${selected}:${item.id}`, (requestId) => ({
      kind: 'backup_preview',
      backupId: selected,
      body: { requestId, kind: item.kind, objectId: item.id },
    }));
  };
  const errors = (
    <>
      {error === null ? null : (
        <p role="alert">
          {error}{' '}
          <button className="text-button" type="button" onClick={refresh}>
            重新读取
          </button>
        </p>
      )}
      {operations.map((op) => (
        <div key={op.key}>
          {op.error === null ? null : <p role="alert">{operationErrorText(op)}</p>}
          <button
            type="button"
            className="text-button"
            disabled={op.status === 'running'}
            onClick={() => {
              if (op.request.kind === 'backup_restore') {
                setOpen(false);
                openPanel({ kind: 'backup_restore', id: op.request.body.previewId });
              } else {
                void run(op.key, () => op.request as Request);
              }
            }}
          >
            再核实备份操作
          </button>
        </div>
      ))}
    </>
  );
  const sheetTrigger = (
    <button className="text-button" type="button" onClick={() => setOpen(true)}>
      {trigger ? '全部备份' : '查看本机备份'}
    </button>
  );
  const Wrapper = trigger ? 'div' : 'section';
  return (
    <Wrapper className={trigger ? 'backups-trigger' : 'block'} aria-label="本机备份">
      {trigger ? null : (
        <header className="block-head">
          <h2 className="block-title">本机备份</h2>
          <span className="block-meta">每天一份 · 保留 30 天 · 不外传</span>
        </header>
      )}
      {sheetTrigger}
      {open ? null : errors}
      <Sheet open={open} title="本机备份" variant={phone ? 'drawer' : 'panel'} onClose={() => setOpen(false)}>
        <div className="backup-detail">
          <p className="block-meta">每天一份 · 保留 30 天 · 不外传</p>
          {errors}
          <button
            className="text-button"
            type="button"
            disabled={operations.some((op) => op.key === 'backup:create' && op.status !== 'failed')}
            onClick={() =>
              void run('backup:create', (requestId) => ({
                kind: 'backup_create',
                body: { requestId },
              }))
            }
          >
            现在生成一份
          </button>
          {(list?.backups ?? []).map((row) => (
            <div className="tool-row" key={row.id}>
              <span className="tool-row-main">
                <time className="text-meta">{localTime(row.createdAt, timeZone)}</time> ·{' '}
                <span className="mono">{fileSize(row.bytes)}</span> ·
                {row.objectCount === undefined ? '条数待核对' : `包含 ${row.objectCount} 条`}
                {row.status === 'ready' ? '' : ` · ${STATUS[row.status]}`}
              </span>
              <button
                type="button"
                className="text-button"
                aria-label={`查看备份 ${localTime(row.createdAt, timeZone)}`}
                onClick={() => setSelected(row.id)}
              >
                校验与恢复
              </button>
            </div>
          ))}
          {detail === null ? null : (
            <>
              <h3>
                <time className="text-meta">{localTime(detail.backup.createdAt, timeZone)}</time>的备份
              </h3>
              <p>{detail.valid ? '完整性校验通过' : '未通过校验，不能恢复'}</p>
              {detail.backup.error === null ? null : <p role="alert">{detail.backup.error}</p>}
              <p>
                对象数：
                {Object.entries(detail.counts)
                  .map(([kind, count]) => `${backupCountLabel(kind)} ${count}`)
                  .join(' · ')}
              </p>
              {detail.objects.map((item) => (
                <div className="tool-row" key={`${item.kind}:${item.id}`}>
                  <span className="tool-row-main">
                    {item.private ? '私密' : ''}{BACKUP_KIND[item.kind]} · {item.label} · 第 {item.version} 版
                  </span>
                  <button
                    className="text-button"
                    type="button"
                    aria-label={`预览恢复 ${item.label}`}
                    disabled={!detail.valid}
                    onClick={() => preview(item)}
                  >
                    预览恢复
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </Sheet>
    </Wrapper>
  );
}
