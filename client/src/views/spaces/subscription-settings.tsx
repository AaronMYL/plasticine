// 订阅设置（设计稿 Library-Subscription「设置」）：订阅本身就是任务设置——关注、偏向、来源、预印本、时间、每期写什么、
// 以后都这样。个人回顾是日报 / 周报的时间、关注的主题、不参考的东西。改的是草稿，点「保存」才存。

import { useState, type ReactNode } from 'react';
import type { ResearchSettings, ReviewSettings, SubscriptionSchedule, SubscriptionSettings } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CLOCKS = Array.from({ length: 24 }, (_unused, hour) => `${String(hour).padStart(2, '0')}:00`);

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return <div className="sub-field"><span className="sub-label">{label}</span><div className="sub-value">{children}</div>
  </div>;
}

function Chips({ values, label, onChange }: { values: readonly string[]; label: string;
  onChange: (next: string[]) => void }): ReactNode {
  const [adding, setAdding] = useState<string | null>(null);
  const commit = (): void => {
    const text = adding?.trim() ?? '';
    if (text !== '' && !values.includes(text)) {
      onChange([...values, text]);
    }
    setAdding(null);
  };
  return (
    <span className="sub-chips">
      {values.map((value) => <span key={value} className="sub-chip">{value}
        <button type="button" aria-label={`去掉「${value}」`} onClick={() => onChange(values.filter((item) => item !== value))}>
          ×</button></span>)}
      {adding === null ? <IconButton icon="plus" label={`加${label}`} className="sub-chip-add"
        onClick={() => setAdding('')} /> : <input className="sub-chip-input" aria-label={`新的${label}`} autoFocus
        value={adding} onChange={(event) => setAdding(event.target.value)} onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setAdding(null);
        }} />}
    </span>
  );
}

function Choice<T extends string>({ label, options, value, onChange }: { label: string;
  options: readonly [T, string][]; value: T | null; onChange: (next: T) => void }): ReactNode {
  return (
    <span className="segmented" role="group" aria-label={label}>
      {options.map(([id, text]) => <button key={id} type="button" className="segmented-item"
        aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>)}
    </span>
  );
}

function ScheduleSelect({ schedule, onChange }: { schedule: SubscriptionSchedule; onChange: (next: SubscriptionSchedule) => void }): ReactNode {
  return (
    <span className="sub-schedule">
      <select aria-label="哪天" className="sub-select" value={schedule.every === 'day' ? 'day' : String(schedule.weekday ?? 1)}
        onChange={(event) => onChange(event.target.value === 'day' ? { every: 'day', time: schedule.time }
          : { every: 'week', weekday: Number(event.target.value), time: schedule.time })}>
        <option value="day">每天</option>
        {WEEKDAYS.map((name, index) => <option key={name} value={String(index)}>每周{name}</option>)}
      </select>
      <select aria-label="几点" className="sub-select" value={schedule.time}
        onChange={(event) => onChange({ ...schedule, time: event.target.value })}>
        {(CLOCKS.includes(schedule.time) ? CLOCKS : [schedule.time, ...CLOCKS]).map((clock) =>
          <option key={clock} value={clock}>{clock}</option>)}
      </select>
    </span>
  );
}

function Rules({ settings, onChange }: { settings: SubscriptionSettings;
  onChange: (rules: SubscriptionSettings['rules']) => void }): ReactNode {
  if (settings.rules.length === 0) {
    return null;
  }
  return (
    <Field label="以后都这样">
      <ul className="sub-rules">
        {settings.rules.map((rule) => <li key={rule.text}><span>{rule.text}</span>
          {rule.fromIssue === null ? null : <span className="text-meta">第 {rule.fromIssue} 期加的</span>}
          <IconButton icon="close" label={`不再「${rule.text}」`}
            onClick={() => onChange(settings.rules.filter((item) => item.text !== rule.text))} /></li>)}
      </ul>
    </Field>
  );
}

function ResearchFields({ settings, onChange }: { settings: ResearchSettings;
  onChange: (next: ResearchSettings) => void }): ReactNode {
  const set = (patch: Partial<ResearchSettings>): void => onChange({ ...settings, ...patch });
  return (
    <>
      <Field label="关注"><Chips label="关注" values={settings.topics} onChange={(topics) => set({ topics })} /></Field>
      <Field label="偏向">
        <span className="sub-row">
          <Choice label="基础还是临床" value={settings.focus} onChange={(focus) => set({ focus })}
            options={[['basic', '基础研究'], ['clinical', '临床应用']]} />
          <Choice label="专业还是科普" value={settings.depth} onChange={(depth) => set({ depth })}
            options={[['expert', '专业'], ['popular', '科普']]} />
        </span>
      </Field>
      <Field label="来源"><Chips label="来源" values={settings.sources} onChange={(sources) => set({ sources })} /></Field>
      <Field label="预印本">
        <label className="sub-row">
          <input type="checkbox" role="switch" aria-label="收预印本" checked={settings.preprints !== 'skip'}
            onChange={(event) => set({ preprints: event.target.checked ? 'mark' : 'skip' })} />
          <span className="text-meta">{settings.preprints === 'skip' ? '不收' : '收，但标出来'}</span>
        </label>
      </Field>
      <Field label="时间"><ScheduleSelect schedule={settings.schedule} onChange={(schedule) => set({ schedule })} />
      </Field>
      <Field label="每期写什么">
        <ol className="sub-sections">{settings.sections.map((section) => <li key={section}>{section}</li>)}</ol>
      </Field>
      <Rules settings={settings} onChange={(rules) => set({ rules })} />
    </>
  );
}

function ReviewFields({ settings, onChange }: { settings: ReviewSettings;
  onChange: (next: ReviewSettings) => void }): ReactNode {
  const set = (patch: Partial<ReviewSettings>): void => onChange({ ...settings, ...patch });
  return (
    <>
      <Field label="日报">
        <span className="sub-row">
          <input type="checkbox" role="switch" aria-label="出日报" checked={settings.daily.on}
            onChange={(event) => set({ daily: { ...settings.daily, on: event.target.checked } })} />
          {settings.daily.on ? <ScheduleSelect schedule={{ every: 'day', time: settings.daily.time }}
            onChange={(next) => set({ daily: { on: true, time: next.time } })} /> : null}
        </span>
      </Field>
      <Field label="周报">
        <span className="sub-row">
          <input type="checkbox" role="switch" aria-label="出周报" checked={settings.weekly.on}
            onChange={(event) => set({ weekly: { ...settings.weekly, on: event.target.checked } })} />
          {settings.weekly.on ? <ScheduleSelect schedule={{ every: 'week', weekday: settings.weekly.weekday,
            time: settings.weekly.time }} onChange={(next) => set({ weekly: { on: true,
            weekday: next.weekday ?? settings.weekly.weekday, time: next.time } })} /> : null}
        </span>
      </Field>
      <Field label="关注"><Chips label="关注" values={settings.topics} onChange={(topics) => set({ topics })} /></Field>
      {settings.exclude.length === 0 ? null : (
        <Field label="不参考">
          <span className="sub-chips">{settings.exclude.map((item) => <span key={`${item.kind}:${item.id}`}
            className="sub-chip">{item.label}<button type="button" aria-label={`重新参考「${item.label}」`}
              onClick={() => set({ exclude: settings.exclude.filter((other) => other !== item) })}>×</button></span>)}
          </span>
        </Field>
      )}
      <Rules settings={settings} onChange={(rules) => set({ rules })} />
    </>
  );
}

export function SubscriptionFields({ settings, onChange }: { settings: SubscriptionSettings;
  onChange: (next: SubscriptionSettings) => void }): ReactNode {
  return settings.kind === 'research' ? <ResearchFields settings={settings} onChange={onChange} />
    : <ReviewFields settings={settings} onChange={onChange} />;
}
