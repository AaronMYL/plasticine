// 设置 · 通用里的「时区」（2026-11-08 第 7 批：从删掉的「日常」一栏挪过来，放在外观后面）。选法、预览在 TimeZoneField；
// 改了先进草稿（切页、刷新都在），出现「保存」才提交；保存没了结时输入锁住，只给「再核实」「重发」。读失败给「重新读取」。

import { useEffect, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { DAILY_SETTINGS_OP_KEY } from '../../state/m4-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { TimeZoneField } from './time-zone-field.tsx';
import { useSettingsDraft } from './settings-dialog-context.ts';

export function TimeZoneSection(): ReactNode {
  const live = useLive();
  const settings = live.dailySettings;
  const { inlineDrafts } = useClientState();
  const data = useStore(settings.data);
  // 草稿变了要重画（字在 inline-drafts 里）。
  useStore(inlineDrafts.store);
  const op = useOp(DAILY_SETTINGS_OP_KEY);
  useEffect(() => {
    settings.open();
  }, [settings]);
  const locked = op !== undefined && isOpenOp(op);
  const problem = data.settings === null ? null : settings.problem();
  const changed = settings.hasChanges();
  useSettingsDraft(!locked && changed, () => settings.discard());
  return (
    <div className="block settings-time-zone-block">
      {data.status === 'loading' || data.status === 'idle' ? <p className="block-empty">正在读时区…</p> : null}
      {data.error === null ? null : (
        <p className="block-empty is-error" role="alert">
          {data.error}{' '}
          <button type="button" className="text-button" onClick={() => void settings.reload()}>
            重新读取
          </button>
        </p>
      )}
      {data.settings === null ? null : (
        <>
          <TimeZoneField value={settings.field('timeZone')} disabled={locked}
            onChange={(value) => settings.change('timeZone', value)} />
          {problem === null ? null : <p className="block-empty is-error">{problem}</p>}
          {changed && !locked ? (
            <button type="button" className="primary-button settings-retry" disabled={problem !== null}
              onClick={() => void settings.save()}>
              保存
            </button>
          ) : null}
          <OpLines
            ops={op === undefined ? [] : [op]}
            onRetry={() => void settings.retry()}
            onDismiss={() => settings.dismiss()}
          />
        </>
      )}
    </div>
  );
}
