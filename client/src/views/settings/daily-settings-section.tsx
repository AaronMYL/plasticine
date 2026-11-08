// 设置浮层里的「日常」一段：时区、十件事最多列几条、离开多久算「回来」、每天回看（2026-11-05 采访删了）。点「保存」才提交；
// 改了的字在草稿里（切页、刷新都在）；保存没了结时输入锁住，只给「再核实」「重发」。读失败给「重新读取」。

import { useEffect, useId, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { DAILY_SETTINGS_OP_KEY } from '../../state/m4-action-requests.ts';
import { useStore } from '../../state/use-store.ts';
import { useOp } from '../pending/pending-ops.tsx';
import type { SettingField } from './daily-settings.ts';
import { TimeZoneField } from './time-zone-field.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useSettingsDraft } from './settings-dialog-context.ts';

const NUMBER_FIELDS: ReadonlyArray<{ field: SettingField; label: string; mode: 'numeric' | 'decimal' }> = [
  { field: 'briefLimit', label: '十件事最多列几条', mode: 'numeric' },
  { field: 'returnThresholdHours', label: '离开多久算「回来」（小时）', mode: 'decimal' },
];

/**
 * 回看开关的说明照 agent 里的实现写（用户视角审查 2026-11-01 P2）：daily/cognition-review.ts + brain/cognition-planner.ts，
 * 你离开够久后每天一次、最多四次模型请求，找反例、遗漏、共同前提。
 * 2026-11-04「每天一项现实碰撞」随判断页一起撤掉（《置信度与做事方式改动方案》第 3 批），回看也不再挑判断。
 */
const DAILY_SWITCHES: ReadonlyArray<{ field: 'cognitionReviewEnabled'; label: string; note: string }> = [
  { field: 'cognitionReviewEnabled', label: '每天回看项目、工作和反例线索',
    note: '打开后你离开够久时 Plasticine 每天回看一次项目里留意中的事和在做的工作，最多四次模型请求找反例、遗漏或共同前提；'
      + '发现记成推测，值得一起想的问题才出卡，不改方向。' },
];

export function DailySettingsSection(): ReactNode {
  const id = useId();
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
  useSettingsDraft(!locked && settings.hasChanges(), () => settings.discard());
  return (
    // 「日常」一段只有这一块：段名就是标题，不再另起一个「今日」小节标题（2026-11-05 设置弹框）。
    <section className="block" aria-label="今日">
      {data.status === 'loading' || data.status === 'idle' ? <p className="block-empty">正在读今日设置…</p> : null}
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
          {NUMBER_FIELDS.map((entry) => (
            <div key={entry.field} className="field settings-number">
              <label className="field-label" htmlFor={`${id}-${entry.field}`}>
                {entry.label}
              </label>
              <input
                id={`${id}-${entry.field}`}
                className="field-input field-input-mono"
                inputMode={entry.mode}
                value={settings.field(entry.field)}
                readOnly={locked}
                onChange={(event) => settings.change(entry.field, event.target.value)}
              />
            </div>
          ))}
          {problem === null ? null : <p className="block-empty is-error">{problem}</p>}
          {DAILY_SWITCHES.map((entry) =>
            // 11-04 重做悬停：每天会发生什么是补充，放在开关名字后的 ⓘ 里；开关本身经 aria-describedby 念 sr-only 那句。
            <div key={entry.field} className="settings-switch-row">
              <label className="settings-switch">
                <input type="checkbox" role="switch" checked={settings.field(entry.field) === 'true'}
                  disabled={locked} aria-label={entry.label} aria-describedby={`${id}-${entry.field}-note`}
                  onChange={() => settings.change(entry.field, String(settings.field(entry.field) !== 'true'))} />
                <span>{entry.label}</span>
              </label>
              <InfoTip label={`「${entry.label}」的说明`} text={entry.note} />
              <span id={`${id}-${entry.field}-note`} className="sr-only">{entry.note}</span>
            </div>)}
          <button
            type="button"
            className="primary-button settings-retry"
            disabled={locked || problem !== null || !settings.hasChanges()}
            onClick={() => void settings.save()}
          >
            保存
          </button>
          <OpLines
            ops={op === undefined ? [] : [op]}
            onRetry={() => void settings.retry()}
            onDismiss={() => settings.dismiss()}
          />
        </>
      )}
    </section>
  );
}
