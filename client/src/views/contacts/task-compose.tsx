// 发任务（2026-11-05 设计稿 Task-Compose / Task-Compose-Group）：聊天头「发任务」点开，浮在聊天右下角的面板。
// 发给谁（一对一就是他；群里下拉：全群 · 谁先接谁做，或指给某个人）、期限（可选）、要做到什么、资料（可选，挑本机文件，
// 读成文字随卡加密发过去）。底下一句后果常显（发出后谁会收到）+ 取消 + 发出。要做到什么的第一句当卡的标题。

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContactRow, MemberFace } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { contactOpKey } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { deadlineOf } from './contact-actions.ts';
import { FaceAvatar } from './contact-avatar.tsx';
import { FaceStack } from './face-stack.tsx';

/** 资料按文字发（≤ 2 万字，接口 TASK_TEXT_MAX_CHARS）。 */
const ATTACHMENT_MAX_CHARS = 20_000;

interface Picked {
  name: string;
  text: string;
}

/** 群里发给谁：null = 全群谁先接谁做。 */
function Recipient({ contact, assignee, onAssignee }: { contact: ContactRow; assignee: string | null;
  onAssignee: (id: string | null) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  if (contact.kind !== 'group') {
    return (
      <div className="task-compose-to">
        <FaceAvatar name={contact.name} avatar={contact.avatar} size={22} />
        <span>{contact.name}</span>
      </div>
    );
  }
  const others = (contact.members ?? []).filter((member) => !member.self);
  const chosen = others.find((member) => member.accountId === assignee) ?? null;
  const pick = (id: string | null): void => {
    onAssignee(id);
    setOpen(false);
  };
  return (
    <div className="task-compose-select">
      <button type="button" className="task-compose-picker" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`发给：${chosen === null ? '全群，谁先接谁做' : chosen.name}`} onClick={() => setOpen(!open)}>
        {chosen === null ? <FaceStack faces={others} size={18} /> : <FaceAvatar name={chosen.name}
          avatar={chosen.avatar} size={20} />}
        <span>{chosen === null ? '全群 · 谁先接谁做' : chosen.name}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="task-compose-options" role="listbox" aria-label="发给谁">
          <Option selected={chosen === null} onPick={() => pick(null)}
            lead={<FaceStack faces={others} size={18} />} label="全群 · 谁先接谁做" />
          <hr />
          {others.map((member: MemberFace) => (
            <Option key={member.accountId} selected={chosen?.accountId === member.accountId}
              onPick={() => pick(member.accountId)} lead={<FaceAvatar name={member.name} avatar={member.avatar}
                size={20} />} label={member.name} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Option({ selected, onPick, lead, label }: { selected: boolean; onPick: () => void; lead: ReactNode;
  label: string }): ReactNode {
  return (
    <button type="button" role="option" aria-selected={selected} className="mention-option" onClick={onPick}>
      {lead}
      <span className="mention-option-label">{label}</span>
      {selected ? <Icon name="check" size={14} /> : null}
    </button>
  );
}

function consequence(contact: ContactRow, assignee: string | null): string {
  if (contact.kind !== 'group') {
    return `发出后${contact.name}会收到`;
  }
  if (assignee !== null) {
    const name = contact.members?.find((member) => member.accountId === assignee)?.name ?? '他';
    return `发出后群里每个人都看得到，只有${name}能接`;
  }
  return '发出后群里每个人都会收到，第一个点「我来接」的人来做';
}

export function TaskCompose({ contact, phone, onClose }: { contact: ContactRow; phone: boolean;
  onClose: () => void }): ReactNode {
  const { contactActions } = useLive();
  const { actionOps } = useClientState();
  const op = useOp(contactOpKey(contact.id, 'task'));
  const locked = op !== undefined && isOpenOp(op);
  const [goal, setGoal] = useState('');
  const [deadline, setDeadline] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const goalBox = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    goalBox.current?.focus();
  }, []);
  const send = async (): Promise<void> => {
    const attachment = picked === null ? null : `${picked.name}\n\n${picked.text}`.slice(0, ATTACHMENT_MAX_CHARS);
    if (await contactActions.sendTask(contact, { goal, deadline: deadlineOf(deadline), attachment, assignee })) {
      onClose();
    }
  };
  return (
    <section className="task-compose" data-phone={phone} aria-label="发任务" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    }}>
      <div className="task-compose-head">
        <Icon name="tasks" size={16} />
        <span>发任务</span>
        <IconButton icon="close" label="关掉发任务" onClick={onClose} />
      </div>
      <div className="task-compose-row">
        <div className="field">
          <span className="field-label">发给谁</span>
          <Recipient contact={contact} assignee={assignee} onAssignee={setAssignee} />
        </div>
        <label className="field">
          <span className="field-label">期限<small>（可选）</small></span>
          <span className="task-compose-date">
            <Icon name="today" size={14} />
            <input type="date" aria-label="期限" value={deadline} disabled={locked}
              onChange={(event) => setDeadline(event.target.value)} />
          </span>
        </label>
      </div>
      <label className="field">
        <span className="field-label">要做到什么</span>
        <textarea ref={goalBox} className="field-input task-compose-goal" rows={3} value={goal} disabled={locked}
          onChange={(event) => setGoal(event.target.value)} />
      </label>
      <div className="field">
        <span className="field-label">资料<small>（可选）</small></span>
        <div className="task-compose-files">
          {picked === null ? null : (
            <span className="task-compose-file">
              <Icon name="paperclip" size={13} />{picked.name}
              <IconButton icon="close" size={12} label={`去掉「${picked.name}」`} onClick={() => setPicked(null)} />
            </span>
          )}
          <button type="button" className="chip-button" disabled={locked}
            onClick={() => fileInput.current?.click()}>
            <Icon name="paperclip" size={14} />加资料
          </button>
          <input ref={fileInput} type="file" accept=".md,.txt,.csv,.json,text/*" hidden aria-label="选一份资料"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) {
                void file.text().then((text) => setPicked({ name: file.name, text }));
              }
            }} />
        </div>
      </div>
      <div className="task-compose-foot">
        <span className="task-compose-hint"><Icon name="info" size={13} />{consequence(contact, assignee)}</span>
        <button type="button" className="text-button text-button-quiet" onClick={onClose}>取消</button>
        <button type="button" className="primary-button" disabled={locked || goal.trim() === ''}
          onClick={() => void send()}>发出</button>
      </div>
      {op === undefined || op.status === 'running' ? null : (
        <OpLine op={op} onRetry={(key) => void contactActions.retry(key)} onDismiss={(key) => actionOps.dismiss(key)} />
      )}
    </section>
  );
}
