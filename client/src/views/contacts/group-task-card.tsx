// 群里的任务卡（2026-11-05 设计稿 Group / Phone-Group）：标题 + 期限、发给谁（成员小头像 +「全群 · 谁先接谁做」或
// 「指给 X」）、谁接了（头像 + 「阿杰接了 · 21:05」+ 在做 / 交付了）。还没人接：「我来接」（主）「让 Plasticine 接」，
// 右边「还没人接」。我是接到的人或发卡的人：下面接着是一对一那张卡的样子（交付、收到 / 再改改）。

import type { ReactNode } from 'react';
import type { GroupTaskView } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { groupTaskOpKey } from '../../state/contacts-action-requests.ts';
import { StatusGlyph } from '../../shell/glyph.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { Spinner } from '../lines/line-parts.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { FaceAvatar } from './contact-avatar.tsx';
import { clockTime, deadlineText } from './contact-time.ts';
import { FaceStack } from './face-stack.tsx';
import { TaskCard } from './task-card.tsx';
import type { Route } from '../../shell/routes.ts';
import './contact-task.css';

const STATE_WORDS: Readonly<Record<GroupTaskView['state'], string>> = {
  open: '还没人接',
  claimed: '在做',
  in_progress: '在做',
  delivered: '交付了',
  passed: '收到了',
  rejected: '再改改',
  declined: '不做了',
  cancelled: '撤回了',
};

function Who({ task }: { task: GroupTaskView }): ReactNode {
  if (task.assignee !== null) {
    return (
      <div className="gt-who">
        <FaceAvatar name={task.assignee.name} avatar={task.assignee.avatar} size={18} />
        <span>指给{task.assignee.self ? '你' : task.assignee.name}</span>
      </div>
    );
  }
  return (
    <div className="gt-who">
      <FaceStack faces={task.members.filter((member) => member.accountId !== task.owner.accountId)} size={18} />
      <span>全群 · 谁先接谁做</span>
    </div>
  );
}

function Claim({ task }: { task: GroupTaskView }): ReactNode {
  const { contactActions } = useLive();
  const op = useOp(groupTaskOpKey(task.id, 'claim'));
  const locked = (op !== undefined && isOpenOp(op)) || task.claiming;
  return (
    <div className="nt-actions">
      <button type="button" className="primary-button" disabled={locked}
        onClick={() => void contactActions.claim(task, 'person')}>我来接</button>
      <button type="button" className="chip-button nt-chip" disabled={locked}
        onClick={() => void contactActions.claim(task, 'ai')}>让 Plasticine 接</button>
      <span className="nt-actions-gap" />
      <span className="gt-nobody">{task.claiming ? '在接…' : '还没人接'}</span>
    </div>
  );
}

function Claimed({ task }: { task: GroupTaskView }): ReactNode {
  const timeZone = useTimeZone();
  const claimer = task.claimer;
  if (claimer === null) {
    return null;
  }
  const running = task.state === 'claimed' || task.state === 'in_progress';
  return (
    <div className="gt-claimed">
      <FaceAvatar name={claimer.name} avatar={claimer.avatar} size={20} />
      <span className="gt-claimer">{claimer.self ? '你' : claimer.name}接了{task.claimedAt === null ? ''
        : <span className="gt-time"> · {clockTime(task.claimedAt, timeZone)}</span>}</span>
      <span className="gt-state">
        {running ? <Spinner size={12} label="在做" /> : null}
        {task.doer === 'ai' && running ? 'Plasticine 在做' : STATE_WORDS[task.state]}
      </span>
    </div>
  );
}

export function GroupTaskCard({ task, now, navigate, detail = false }: { task: GroupTaskView; now: Date;
  navigate: (route: Route) => void; detail?: boolean }): ReactNode {
  const timeZone = useTimeZone();
  const open = useOpenPanel();
  const pair = task.pair;
  // 接到的是我，或者轮到发卡的我收结果：一对一那张卡的样子接着往下画（在做、交付、收到 / 再改改）。
  if (pair !== null && task.state !== 'open' && (task.claimer?.self === true || pair.waiting
    || pair.state === 'passed')) {
    const counterpart = task.owner.self ? task.claimer?.name ?? '对方' : task.owner.name;
    return (
      <div className="gt-pair">
        <TaskCard task={pair} name={counterpart} now={now} navigate={navigate} groupTaskId={task.id} detail={detail} />
      </div>
    );
  }
  const waiting = task.canClaim && task.assignee?.self === true;
  return (
    <article className="nt-card" data-side={task.owner.self ? 'me' : 'them'} aria-label={`任务：${task.title}`}>
      <div className="nt-card-head">
        {task.canClaim ? <StatusGlyph status="wait" label={waiting ? '等你接' : '还没人接'} /> : null}
        <h3 className="nt-card-title">{detail ? task.title : <button type="button" className="nt-work-link"
          aria-label={`查看工作：${task.title}`} onClick={() => open({ kind: 'work', groupTaskId: task.id })}>
          {task.title}</button>}</h3>
        {task.deadline === null ? null
          : <span className="nt-deadline" title="期限">{deadlineText(task.deadline, now, timeZone)}</span>}
      </div>
      <Who task={task} />
      <Claimed task={task} />
      {task.canClaim ? <Claim task={task} /> : null}
      {task.state === 'cancelled' ? <p className="nt-status">撤回了</p> : null}
    </article>
  );
}
