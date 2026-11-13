import { useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import type { LineView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Markdown } from '../../primitives/message/markdown.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { WorkStatusGlyph, workStatusText } from '../lines/work-status.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { MateAvatar, GroupAvatar } from './mate-avatar.tsx';
import '../contacts/contact-task.css';
import './mate-group-tasks.css';

export function MateGroupTaskCard({ line }: { line: LineView }): ReactNode {
  const live = useLive();
  const state = useClientState();
  const timeZone = useTimeZone();
  const open = useOpenPanel();
  const roster = useStore(live.mates.data);
  const thread = useStore(live.lines.thread(line.id));
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const [reading, setReading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const op = useOp(`mate-groups:task:claim:${line.id}`);
  const locked = reading || (op !== undefined && isOpenOp(op));
  const group = roster.groups.find((item) => item.id === line.mateGroupId);
  const members = roster.mates.filter((mate) => group?.mateIds.includes(mate.id) && mate.disabledAt === null);
  const mate = roster.mates.find((item) => item.id === line.mateId);
  const unclaimed = line.mateId == null && line.status === 'paused' && line.queued > 0;
  const delivered = line.status === 'idle' && line.outcome === 'done' && !line.queued
    && line.unmet == null && line.failure === null;
  const result = thread.messages.findLast((message) => message.role === 'assistant' && message.text.trim() !== '')
    ?.text ?? line.lastAnswer;
  const claim = async (mateId: string): Promise<void> => {
    setMenu(null); setReading(true); setError(null);
    try {
      await live.lines.loadLatest(line.id);
      const current = live.lines.thread(line.id).get();
      if (current.error !== null) throw new Error(current.error);
      const goal = current.queue[0]?.text;
      if (goal === undefined || goal.trim() === '') throw new Error('任务原文还没读到，请稍后再试。');
      await live.mateActions.claimTask(line, mateId, goal);
    } catch (cause) { setError(errorText(cause)); }
    finally { setReading(false); }
  };
  return <article className="nt-card mate-group-task" aria-label={`任务：${line.title}`}>
    <div className="nt-card-head">
      <span className="mate-task-lead">{unclaimed ? <StatusGlyph status="idle" label="待领取" />
        : <WorkStatusGlyph line={line} />}</span>
      <h3 className="nt-card-title"><button className="nt-work-link" type="button"
        aria-label={`${unclaimed ? '查看任务原文' : '查看工作'}：${line.title}`}
        aria-expanded={unclaimed ? expanded : undefined}
        onClick={() => unclaimed ? setExpanded((value) => !value) : open({ kind: 'work', lineId: line.id })}>
        {line.title}</button></h3>
    </div>
    {unclaimed ? <div className="gt-who"><GroupAvatar mates={members} /><span>全群待领</span></div>
      : <div className="gt-claimed">
        {mate === undefined ? null : <MateAvatar mate={mate} size={20} />}
        <span className="gt-claimer">{mate === undefined ? '领取人未记录' : `${mate.name}接了`}</span>
        <span className="gt-state">{delivered ? '已交付' : workStatusText(line, timeZone)}</span>
      </div>}
    {unclaimed && expanded ? <p className="nt-delivery">{thread.queue[0]?.text
      ?? thread.error ?? '任务原文正在读取…'}</p> : null}
    {delivered && result ? <div className="nt-delivery"><Markdown text={result} /></div> : null}
    {unclaimed ? <div className="nt-actions"><button type="button" className="chip-button"
      aria-label="选择领取队友" disabled={locked || members.length === 0}
      onClick={(event) => setMenu(anchorOf(event.currentTarget))}>{reading ? '读取原文…' : '让队友领取'}</button></div>
      : null}
    {error === null ? null : <p className="line-note is-error" role="alert">{error}</p>}
    {op === undefined ? null : <OpLine op={op} onRetry={(key) => { void live.mateActions.retry(key); }}
      onDismiss={(key) => state.actionOps.dismiss(key)} />}
    {menu === null ? null : <Popover anchor={menu} role="menu" label="领取任务" onClose={() => setMenu(null)}>
      {members.map((member) => <button key={member.id} type="button" role="menuitem"
        className="popover-item" aria-label={`${member.name}领取`} onClick={() => { void claim(member.id); }}>
        <MateAvatar mate={member} size={24} still /><span>{member.name}</span></button>)}
    </Popover>}
  </article>;
}
