// 联系人页的两个浮层（原语 7 · Sheet，电脑浮在主区里、手机从底下推上来）：发任务（标题、要做到什么、验收看到什么、期限）和
// 加联系人（@handle、一句话）。字在 inline-drafts，发出去拿到结果才清；没了结时锁住，下面一行能核实或重发。

import type { ReactNode } from 'react';
import type { ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { CONTACT_ADD_OP_KEY, contactOpKey } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { addDraftKey, taskDraftKey, type TaskField } from './contact-actions.ts';

function DraftField({ draftKey, label, multiline, type, disabled, placeholder }: { draftKey: string; label: string;
  multiline?: boolean; type?: string; disabled: boolean; placeholder?: string }): ReactNode {
  const { inlineDrafts } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const value = drafts.get(draftKey) ?? '';
  const change = (text: string): void => inlineDrafts.set(draftKey, text);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline === true ? (
        <textarea className="field-input" rows={3} value={value} disabled={disabled} placeholder={placeholder}
          onChange={(event) => change(event.target.value)} />
      ) : (
        <input className="field-input" type={type ?? 'text'} value={value} disabled={disabled}
          placeholder={placeholder} onChange={(event) => change(event.target.value)} />
      )}
    </label>
  );
}

const TASK_FIELDS: ReadonlyArray<{ field: TaskField; label: string; multiline?: boolean; type?: string }> = [
  { field: 'title', label: '标题' },
  { field: 'goal', label: '要做到什么', multiline: true },
  { field: 'acceptance', label: '验收看到什么', multiline: true },
  { field: 'deadline', label: '期限', type: 'datetime-local' },
];

export function TaskSheet({ contact, open, phone, onClose }: { contact: ContactRow; open: boolean; phone: boolean;
  onClose: () => void }): ReactNode {
  const { contactActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(contactOpKey(contact.id, 'task'));
  const locked = op !== undefined && isOpenOp(op);
  const filled = (['title', 'goal', 'acceptance'] as const)
    .every((field) => (drafts.get(taskDraftKey(contact.id, field)) ?? '').trim() !== '');
  const submit = async (): Promise<void> => {
    if (await contactActions.createTask(contact)) {
      onClose();
    }
  };
  return (
    <Sheet open={open} variant={phone ? 'drawer' : 'panel'} title={`发任务给${contact.name}`} onClose={onClose}>
      <form className="contact-sheet-form" onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        {TASK_FIELDS.map(({ field, label, multiline, type }) => (
          <DraftField key={field} draftKey={taskDraftKey(contact.id, field)} label={label} disabled={locked}
            {...(multiline === undefined ? {} : { multiline })} {...(type === undefined ? {} : { type })} />
        ))}
        <button type="submit" className="primary-button contact-sheet-submit" disabled={locked || !filled}>
          发出去
        </button>
        {op === undefined || op.status === 'running' ? null : (
          <OpLine op={op} onRetry={(key) => void contactActions.retry(key)}
            onDismiss={(key) => actionOps.dismiss(key)} />
        )}
      </form>
    </Sheet>
  );
}

export function AddContactSheet({ open, phone, onClose, onAdded }: { open: boolean; phone: boolean;
  onClose: () => void; onAdded: (id: string) => void }): ReactNode {
  const { contactActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(CONTACT_ADD_OP_KEY);
  const locked = op !== undefined && isOpenOp(op);
  const handle = (drafts.get(addDraftKey('handle')) ?? '').trim();
  const submit = async (): Promise<void> => {
    const id = await contactActions.add();
    if (id !== null) {
      onClose();
      onAdded(id);
    }
  };
  return (
    <Sheet open={open} variant={phone ? 'drawer' : 'panel'} title="加联系人" onClose={onClose}>
      <form className="contact-sheet-form" onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}>
        <DraftField draftKey={addDraftKey('handle')} label="@handle" placeholder="linyi" disabled={locked} />
        <DraftField draftKey={addDraftKey('note')} label="一句话" disabled={locked} />
        <button type="submit" className="primary-button contact-sheet-submit" disabled={locked || handle === ''}>
          添加
        </button>
        {op === undefined || op.status === 'running' ? null : (
          <OpLine op={op} onRetry={(key) => void contactActions.retry(key)}
            onDismiss={(key) => actionOps.dismiss(key)} />
        )}
      </form>
    </Sheet>
  );
}
