// 聊天里的一张任务卡（2026-11-05 设计稿 Friend-Task-States）：站在发起方一侧；标题 + 期限、五段进度（发出 · 点头 ·
// 在做 · 交付 · 收到）、一句状态。发起人那边：等对方点头（可撤回）→ 对方的 Plasticine 在做（计时）→ 交付了（结果 +
// 「收到」「再改改」）→ 收到了（结果收起）。收到的那边：「让 Plasticine 做」ⓘ「我来做」「先不」→ 我的 Plasticine 在做
// （这会儿做到哪、计时、停止）/ 我来做（写交付、「交付」ⓘ）。等我的那几张标题前一个陶土橙点。

import { useState, type ReactNode } from 'react';
import type { NetworkTaskView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { networkTaskOpKey } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import type { Route } from '../../shell/routes.ts';
import { AiMark, StatusGlyph } from '../../shell/glyph.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { Spinner } from '../lines/line-parts.tsx';
import { elapsedText, useNow } from '../lines/line-time.ts';
import { WorkStatusGlyph, workStatusText } from '../lines/work-status.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { clockTime, deadlineText } from './contact-time.ts';
import { progressLabel, segments } from './task-status.ts';
import './contact-task.css';

export interface TaskCardProps {
  task: NetworkTaskView;
  /** 对方的名字。 */
  name: string;
  now: Date;
  navigate: (route: Route) => void;
  groupTaskId?: string;
  detail?: boolean;
}

const BY_AI_TIP = 'Plasticine 按这张任务卡执行，做完交给';

export function Bars({ task }: { task: Pick<NetworkTaskView, 'stage' | 'state'> }): ReactNode {
  const label = progressLabel(task);
  return (
    <div className="nt-bars" role="img" aria-label={label}>
      {segments(task).map((state, index) => <span key={index} data-state={state} />)}
    </div>
  );
}

function useLocked(task: NetworkTaskView, action: 'decide' | 'deliver' | 'verdict' | 'cancel' | 'stop'): boolean {
  const op = useOp(networkTaskOpKey(task.id, action));
  return op !== undefined && isOpenOp(op);
}

/** 在做的计时（从点头那一刻起，m:ss）。 */
function Elapsed({ since }: { since: string | null | undefined }): ReactNode {
  const now = useNow(since !== null && since !== undefined);
  if (since === null || since === undefined) {
    return null;
  }
  return <span className="mono nt-elapsed">{elapsedText(now - Date.parse(since))}</span>;
}

function Status({ lead, children, tail }: { lead: ReactNode; children: ReactNode; tail?: ReactNode }): ReactNode {
  return (
    <div className="nt-status-row">
      {lead}
      <span className="nt-status-text">{children}</span>
      {tail}
    </div>
  );
}

function Decide({ task, name }: { task: NetworkTaskView; name: string }): ReactNode {
  const { contactActions } = useLive();
  const locked = useLocked(task, 'decide');
  return (
    <div className="nt-actions">
      <button type="button" className="primary-button" disabled={locked}
        onClick={() => void contactActions.decide(task, 'by_ai')}>让 Plasticine 做</button>
      <InfoTip text={`${BY_AI_TIP} ${name}`} label="让 Plasticine 做会怎样" />
      <button type="button" className="chip-button nt-chip" disabled={locked}
        onClick={() => void contactActions.decide(task, 'by_person')}>我来做</button>
      <span className="nt-actions-gap" />
      <button type="button" className="text-button text-button-quiet" disabled={locked}
        onClick={() => void contactActions.decide(task, 'decline')}>先不</button>
    </div>
  );
}

function Deliver({ task, name, detail = false }:
  { task: NetworkTaskView; name: string; detail?: boolean }): ReactNode {
  const { contactActions } = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const key = networkTaskOpKey(task.id, 'deliver');
  const locked = useLocked(task, 'deliver');
  const text = drafts.get(key) ?? '';
  return (
    <div className="nt-form">
      {task.state === 'rejected' && task.verdict?.note ? <p className="nt-status">再改改：{task.verdict.note}</p> : null}
      <textarea className="field-input nt-input" rows={3} aria-label={`交付「${task.title}」`} value={text}
        disabled={locked} placeholder={detail ? '写下交付内容' : task.goal}
        onChange={(event) => inlineDrafts.set(key, event.target.value)} />
      <div className="nt-actions">
        <button type="button" className="primary-button" disabled={locked || text.trim() === ''}
          onClick={() => void contactActions.deliver(task)}>交付</button>
        <span className="nt-hint"><Icon name="info" size={13} />交付后 {name} 马上能看到</span>
      </div>
    </div>
  );
}

function Receive({ task }: { task: NetworkTaskView }): ReactNode {
  const { contactActions } = useLive();
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const key = networkTaskOpKey(task.id, 'verdict');
  const locked = useLocked(task, 'verdict');
  const [revising, setRevising] = useState(false);
  if (revising) {
    return (
      <div className="nt-form">
        <input className="field-input nt-note" aria-label="哪里再改改" placeholder="哪里再改改" autoFocus
          value={drafts.get(key) ?? ''} disabled={locked}
          onChange={(event) => inlineDrafts.set(key, event.target.value)} />
        <div className="nt-actions">
          <button type="button" className="primary-button" disabled={locked}
            onClick={() => void contactActions.verdict(task, 'reject')}>发回去</button>
          <button type="button" className="text-button text-button-quiet" onClick={() => setRevising(false)}>取消</button>
        </div>
      </div>
    );
  }
  return (
    <div className="nt-actions">
      <button type="button" className="primary-button" disabled={locked}
        onClick={() => void contactActions.verdict(task, 'pass')}>收到</button>
      <button type="button" className="chip-button nt-chip" disabled={locked} onClick={() => setRevising(true)}>
        再改改</button>
    </div>
  );
}

function Result({ text }: { text: string }): ReactNode {
  return <div className="nt-delivery">{text}</div>;
}

function Folded({ text }: { text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="nt-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        结果<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </button>
      {open ? <Result text={text} /> : null}
    </>
  );
}

/** 我发出去的那一张。 */
function OutBody({ task, name }: { task: NetworkTaskView; name: string }): ReactNode {
  const { contactActions } = useLive();
  const timeZone = useTimeZone();
  const cancelling = useLocked(task, 'cancel');
  const theirAi = `${name}的 Plasticine `;
  switch (task.state) {
    case 'offered':
      return (
        <>
          <Status lead={<Icon name="clock" size={13} />}>等{name}点头</Status>
          <div className="nt-actions nt-actions-tight">
            <button type="button" className="text-button" disabled={cancelling}
              onClick={() => void contactActions.cancel(task)}>撤回</button>
          </div>
        </>
      );
    case 'accepted':
    case 'in_progress':
      return task.doer === 'ai'
        ? <Status lead={<Spinner size={13} label="在做" />} tail={<Elapsed since={task.decidedAt} />}>
          <AiMark label={theirAi} /> {theirAi}在做…</Status>
        : <Status lead={<Spinner size={13} label="在做" />} tail={<Elapsed since={task.decidedAt} />}>
          {name}在做</Status>;
    case 'delivered':
      return (
        <>
          <Status lead={task.doer === 'ai' ? <AiMark label={theirAi} /> : <Icon name="check" size={13} />}>
            {task.doer === 'ai' ? theirAi : name}交付了{task.delivery === null ? '' : ` · ${clockTime(task.delivery.at,
              timeZone)}`}
          </Status>
          {task.delivery === null ? null : <Result text={task.delivery.text} />}
          {task.waiting ? <Receive task={task} /> : null}
        </>
      );
    case 'passed':
      return (
        <>
          <Status lead={<span className="nt-ok"><Icon name="check" size={13} /></span>}>
            收到了{task.verdict === null ? '' : ` · ${clockTime(task.verdict.at, timeZone)}`}</Status>
          {task.delivery === null ? null : <Folded text={task.delivery.text} />}
        </>
      );
    case 'rejected':
      return <Status lead={<Icon name="clock" size={13} />}>等对方修改
        {task.verdict?.note ? ` · ${task.verdict.note}` : ''}</Status>;
    case 'declined':
      return <Status lead={null}>{name}先不接</Status>;
    case 'cancelled':
      return <Status lead={null}>撤回了</Status>;
  }
}

/** 别人发给我的那一张。 */
function InBody({ task, name }: { task: NetworkTaskView; name: string }): ReactNode {
  const { contactActions } = useLive();
  const open = useOpenPanel();
  const timeZone = useTimeZone();
  const stopping = useLocked(task, 'stop');
  switch (task.state) {
    case 'offered':
      return (
        <>
          <p className="nt-acceptance">{task.goal}</p>
          <Decide task={task} name={name} />
        </>
      );
    case 'accepted':
    case 'in_progress':
    case 'rejected':
      if (task.doer === 'ai' && task.state === 'rejected') return <Status
        lead={<StatusGlyph status="wait" label="等你决定" />} tail={<button type="button"
          className="primary-button button-small" onClick={() => open({ kind: 'work', taskId: task.id })}>
          补充修改意见</button>}>等你决定</Status>;
      if (task.doer === 'ai') {
        return (
          <Status lead={task.execution == null ? <Icon name="clock" size={13} />
            : <WorkStatusGlyph line={task.execution} />} tail={<>
            {task.execution?.status === 'running' ? <Elapsed since={task.activity?.since ?? task.decidedAt} /> : null}
            <button type="button" className="chip-button nt-chip" disabled={stopping}
              onClick={() => void contactActions.stop(task)}>我来处理</button>
          </>}>{task.execution == null ? '已交给 Plasticine' : workStatusText({ ...task.execution,
            activity: task.activity?.text ?? null }, timeZone)}</Status>
        );
      }
      return <Deliver task={task} name={name} />;
    case 'delivered':
      return (
        <>
          <Status lead={<Icon name="clock" size={13} />}>交给{name}了，等他收
            {task.delivery === null ? '' : ` · ${clockTime(task.delivery.at, timeZone)}`}</Status>
          {task.delivery === null ? null : <Folded text={task.delivery.text} />}
        </>
      );
    case 'passed':
      return <Status lead={<span className="nt-ok"><Icon name="check" size={13} /></span>}>{name}收到了</Status>;
    case 'declined':
      return <Status lead={null}>你先不接</Status>;
    case 'cancelled':
      return <Status lead={null}>{name}撤回了</Status>;
  }
}

function TaskOps({ task }: { task: NetworkTaskView }): ReactNode {
  const { contactActions } = useLive();
  const { actionOps } = useClientState();
  const ops = useStore(actionOps.store).filter((op) => op.key.startsWith(`network-task:${task.id}:`)
    && op.status !== 'running');
  return ops.map((op) => (
    <OpLine key={op.key} op={op} onRetry={(key) => void contactActions.retry(key)}
      onDismiss={(key) => actionOps.dismiss(key)} />
  ));
}

function waitLabel(task: NetworkTaskView): string {
  if (task.direction === 'in') {
    return task.state === 'offered' ? '等你定' : '等你交付';
  }
  return '等你收';
}

export function TaskCard({ task, name, now, groupTaskId, detail = false }: TaskCardProps): ReactNode {
  const timeZone = useTimeZone();
  const open = useOpenPanel();
  const incoming = task.direction === 'in';
  return (
    <article className="nt-card" data-side={incoming ? 'them' : 'me'} aria-label={`任务：${task.title}`}>
      <div className="nt-card-head">
        {task.waiting ? <StatusGlyph status="wait" label={waitLabel(task)} /> : null}
        <h3 className="nt-card-title">{detail ? task.title : <button type="button" className="nt-work-link"
          aria-label={`查看工作：${task.title}`} onClick={() => open(groupTaskId === undefined
            ? { kind: 'work', taskId: task.id } : { kind: 'work', groupTaskId })}>{task.title}</button>}</h3>
        {task.deadline === null ? null
          : <span className="nt-deadline" title="期限">{deadlineText(task.deadline, now, timeZone)}</span>}
      </div>
      {incoming && task.state === 'offered' ? null : <Bars task={task} />}
      {incoming ? <InBody task={task} name={name} /> : <OutBody task={task} name={name} />}
      <TaskOps task={task} />
    </article>
  );
}

/** 详情里只保留这阶段能做的事；成果由详情完整展示，避免同一份正文折叠、展开各写一次。 */
export function TaskDetailActions({ task, name }: { task: NetworkTaskView; name: string }): ReactNode {
  const { contactActions } = useLive();
  const locked = useLocked(task, 'stop');
  let actions: ReactNode = null;
  if (task.direction === 'in' && task.state === 'offered') actions = <Decide task={task} name={name} />;
  else if (task.direction === 'in' && ['accepted', 'in_progress', 'rejected'].includes(task.state)) {
    actions = task.doer === 'person' ? <Deliver task={task} name={name} detail />
      : <button type="button" className="text-button" disabled={locked}
        onClick={() => void contactActions.stop(task)}>我来处理</button>;
  } else if (task.direction === 'out' && task.state === 'delivered') actions = <Receive task={task} />;
  else if (task.state === 'delivered') actions = <p className="work-state-note">已交给{name}，等对方收</p>;
  else if (task.state === 'passed') actions = <p className="work-state-note">{name}收到了</p>;
  else if (task.direction === 'out') actions = <OutBody task={task} name={name} />;
  return <div className="work-task-actions">{actions}<TaskOps task={task} /></div>;
}
