import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { RestorePreview } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useOpenPanel } from '../../shell/panel.ts';
import { operationErrorText } from '../../primitives/task-row/op-line.tsx';
import { BACKUP_KIND } from './backup-labels.ts';
import { BackupComparison } from './backup-comparison.tsx';
import { formatDay } from '../../primitives/message/states.ts';
import './backups.css';
export function BackupRestoreEntry({ id }: { id: string }): ReactNode {
  const open = useOpenPanel();
  return (
    <button className="text-button" type="button" onClick={() => open({ kind: 'backup_restore', id })}>
      查看恢复预览与回执
    </button>
  );
}
export function BackupRestoreCard({ id }: { id: string }): ReactNode {
  const api = useApi();
  const live = useLive();
  const timeZone = useTimeZone();
  const state = useClientState();
  const key = `backup:restore:${id}`;
  const op = useStore(state.actionOps.store).find((item) => item.key === key);
  const noteDrafts = useStore(state.noteDrafts.store);
  const [row, setRow] = useState<RestorePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((old) => old + 1);
  useEffect(
    () =>
      live.hub.on((event) => {
        if (
          event.type === 'backups.changed' ||
          event.type === 'resync' ||
          event.type === 'ask.answered' ||
          event.type === 'ask.updated'
        ) {
          refresh();
        }
      }),
    [live],
  );
  useEffect(() => {
    const controller = new AbortController();
    void api.backups.getPreview(id, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setRow(value);
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
  }, [api, id, revision]);
  const restore = async () => {
    if (row === null) {
      return;
    }
    const request = state.actionOps.begin(
      key,
      '按对象恢复',
      '本机备份',
      (requestId) => ({
        kind: 'backup_restore',
        backupId: row.backupId,
        body: {
          requestId,
          previewId: row.id,
          digest: row.digest,
          backupName: row.backupName,
          askVersion: row.askVersion,
        },
      }),
      createRequestId,
    );
    if (request.kind !== 'backup_restore') {
      return;
    }
    try {
      const target = { kind: 'backup_restore' as const, backupId: request.backupId };
      const bodyText = JSON.stringify(request.body);
      const result = await api.signed.send({ target, bodyText });
      if (result.kind !== 'backup_restored') {
        throw new Error('没有读到恢复回执。');
      }
      state.actionOps.succeed(key);
      state.editDrafts.clear(key);
      setRow(result.preview);
    } catch (cause) {
      state.actionOps.fail(key, cause);
    }
    refresh();
  };
  const pending = op !== undefined && op.status !== 'failed';
  const localDraft = row?.kind === 'note' && noteDrafts.has(row.objectId);
  return (
    <section className="ask-card backup-restore-card" aria-label="按对象恢复确认">
      <div className="ask-card-head">
        <span className="tag tag-outline">要你确认</span>
      </div>
      {error === null ? null : (
        <p role="alert">
          {error}
          <button type="button" className="text-button" onClick={refresh}>
            重新读取预览
          </button>
        </p>
      )}
      {op?.error == null ? null : <p role="alert">{operationErrorText(op)}</p>}
      {!pending ? null : (
        <button
          className="text-button"
          type="button"
          disabled={op.status === 'running'}
          onClick={() => void restore()}
        >
          再核实恢复
        </button>
      )}
      {row === null ? (
        <p>正在读取预览…</p>
      ) : (
        <>
          <h3 className="ask-question">
            把《{row.objectLabel ?? BACKUP_KIND[row.kind]}》恢复成{' '}
            {formatDay(row.backupCreatedAt ?? row.backupName.slice(0, 10), timeZone)}备份里的样子？
            （会先保存现在的版本）
          </h3>
          <BackupComparison before={row.before} after={row.after} kind={row.kind} />
          {row.blocked.map((message) => (
            <p key={message} role="alert">
              {message}
            </p>
          ))}
          {row.status === 'restored' ? <p>这个对象已恢复为新版本。</p> : null}
          {row.status === 'rejected' ? <p>这次恢复已关闭，需要恢复时请重新预览。</p> : null}
          {row.status === 'pending' && row.blocked.length === 0 ? (
            <>
              {localDraft ? <p role="alert">这篇笔记还有本地草稿，请先回笔记页保存或处理冲突。</p> : null}
              <div className="ask-options">
                <button
                  className="primary-button"
                  type="button"
                  disabled={pending || localDraft}
                  onClick={() => void restore()}
                >
                  确认恢复
                </button>
                {row.askId === null ? null : (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      void api.asks
                        .get(row.askId ?? '')
                        .then((ask) => live.asks.defer(ask))
                        .catch((cause: unknown) => setError(errorText(cause)));
                    }}
                  >
                    先不
                  </button>
                )}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
