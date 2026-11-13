// 群组的分工面板（11-13 Aaron 看过设计稿定的）：最上面四个数（在做、等你、待领、做完）；等你和待领排最前
// （去答 / 让队友领取）；每位队友一块写在做什么、做到哪、多久了，做完的收成一行。同一件事只出现在一个人名下。

import { useState, type ReactNode } from 'react';
import type { LineView, MateGroupView, MateView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { lineElapsed, useNow } from '../lines/line-time.ts';
import { WorkStatusGlyph, workStatusText } from '../lines/work-status.tsx';
import { groupLines, groupWork } from './group-work.ts';
import { MateAvatar } from './mate-avatar.tsx';
import { MateGroupTaskCard } from './mate-group-task-card.tsx';
import { MateGroupTaskEditor } from './mate-group-task-editor.tsx';

function Stat({ value, label, tone }: { value: number; label: string; tone?: 'run' | 'wait' | 'done' }): ReactNode {
  return <div className="mate-work-stat" data-tone={tone}><dd>{value}</dd><dt>{label}</dt></div>;
}

/** 一件事一行：状态符号、标题（点了看这件工作）、下面一行状态和已用时间；行尾可以带一个动作。 */
function WorkRow({ line, state, action }: { line: LineView; state?: string; action?: ReactNode }): ReactNode {
  const open = useOpenPanel();
  const timeZone = useTimeZone();
  const now = useNow(line.status === 'running');
  const elapsed = line.status === 'running' ? lineElapsed(line, now) : null;
  return <li className="mate-work-row">
    <span className="mate-work-glyph"><WorkStatusGlyph line={line} /></span>
    <button type="button" className="mate-work-open" aria-label={`查看工作：${line.title}`}
      onClick={() => open({ kind: 'work', lineId: line.id })}>
      <span className="mate-work-title">{line.title}</span>
      <span className="mate-work-state">{state ?? workStatusText(line, timeZone)}
        {elapsed === null ? null : ` · ${elapsed}`}</span>
    </button>
    {action}
  </li>;
}

function Person({ mate, lines }: { mate: MateView; lines: LineView[] }): ReactNode {
  const work = groupWork(lines);
  const active = [...work.waiting, ...work.doing];
  const running = work.doing.find((line) => line.status === 'running') ?? work.doing[0];
  const state = mate.disabledAt !== null ? '已停用' : work.waiting.length > 0 ? '等你回答'
    : running !== undefined ? `在做「${running.title}」` : '空着';
  return <section className="mate-work-person" aria-label={mate.name}>
    <header><MateAvatar mate={mate} size={28} />
      <div><h4>{mate.name}</h4><p>{state}</p></div></header>
    {active.length === 0 ? null : <ul className="mate-work-rows">
      {active.map((line) => <WorkRow key={line.id} line={line} />)}</ul>}
    {work.done.length === 0 ? null : <details className="mate-work-done">
      <summary><Icon name="check" size={13} />做完 {work.done.length}<Icon name="chevron-down" size={12} /></summary>
      <ul className="mate-work-rows">{work.done.map((line) => <WorkRow key={line.id} line={line} />)}</ul>
    </details>}
  </section>;
}

export function MateWorkPanel({ group, phone = false, onClose }: { group: MateGroupView; phone?: boolean;
  onClose?: (() => void) | undefined }): ReactNode {
  const live = useLive();
  const open = useOpenPanel();
  const roster = useStore(live.mates.data);
  const list = useStore(live.lines.list);
  const tasks = useStore(live.mates.taskList(group.id));
  const asks = useStore(live.asks.store);
  const [creating, setCreating] = useState(false);
  const lines = groupLines(group, list.lines, tasks.lines);
  const work = groupWork(lines);
  const mates = group.mateIds.flatMap((id) => roster.mates.find((candidate) => candidate.id === id) ?? []);
  const nameOf = (line: LineView): string => roster.mates.find((mate) => mate.id === line.mateId)?.name ?? '队友';
  return <aside className="mate-work-panel" aria-label="群组分工">
    <header className="mate-work-heading"><h3>分工</h3>
      <button type="button" className="secondary-button button-small" onClick={() => setCreating(true)}>
        <Icon name="plus" size={14} />发布任务</button>
      {phone && onClose !== undefined ? <IconButton icon="close" label="收起分工" onClick={onClose} /> : null}
    </header>
    <dl className="mate-work-stats" role="group" aria-label="这个群的事">
      <Stat value={work.doing.length} label="在做" tone="run" />
      <Stat value={work.waiting.length} label="等你" tone="wait" />
      <Stat value={work.unclaimed.length} label="待领" />
      <Stat value={work.done.length} label="做完" tone="done" />
    </dl>
    {tasks.error === null ? null : <p className="line-note is-error" role="alert">{tasks.error}
      <button type="button" className="text-button" onClick={() => { void live.mates.reloadTasks(group.id); }}>
        再读一次</button></p>}
    {work.waiting.length === 0 ? null : <section className="mate-work-block" aria-label="等你">
      <h4 className="mate-work-label">等你</h4>
      <ul className="mate-work-rows">{work.waiting.map((line) => <WorkRow key={line.id} line={line}
        state={`${nameOf(line)}问：${asks.open.find((ask) => ask.lineId === line.id)?.question ?? '等你决定'}`}
        action={<button type="button" className="primary-button button-small"
          onClick={() => open({ kind: 'work', lineId: line.id })}>去答</button>} />)}</ul>
    </section>}
    {work.unclaimed.length === 0 ? null : <section className="mate-work-block" aria-label="待领">
      <h4 className="mate-work-label">待领</h4>
      <div className="mate-work-tasks">{work.unclaimed.map((line) => <MateGroupTaskCard key={line.id} line={line} />)}
      </div>
    </section>}
    {mates.map((mate) => <Person key={mate.id} mate={mate}
      lines={lines.filter((line) => line.mateId === mate.id)} />)}
    {creating ? <MateGroupTaskEditor group={group} phone={phone} onClose={() => setCreating(false)} /> : null}
  </aside>;
}
