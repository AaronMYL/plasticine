// 新请求（第 113 条；2026-11-05 设计稿 Friend-Request）：对方加了我、我还没接受的人，一人一张卡——头像、名字、@handle、
// 时间；他附的那句话；关系（陌生人 · 合作 · 朋友，ⓘ 说清各能听到哪几档）；「接受」（主）「忽略」。接受时按选的关系
// 记下（先接受、再改关系），然后打开和他的聊天。拉黑收在资料栏里（做了收不回）。

import { useState, type ReactNode } from 'react';
import { CONTACT_RELATION_LABELS, CONTACT_RELATIONS, type ContactRelation, type ContactRow } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { contactOpKey } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { ContactAvatar } from './contact-avatar.tsx';
import { clockTime } from './contact-time.ts';
import './network.css';

const RELATION_TIP = '陌生人只听到公开的；合作、朋友各多一档';
const SHORT_LABELS: Readonly<Record<ContactRelation, string>> = { stranger: '陌生人', partner: '合作', friend: '朋友' };

function RequestCard({ row, onAccepted }: { row: ContactRow; onAccepted: (id: string) => void }): ReactNode {
  const { contactActions, contacts } = useLive();
  const { actionOps } = useClientState();
  const timeZone = useTimeZone();
  const op = useOp(contactOpKey(row.id, 'request'));
  const locked = op !== undefined && isOpenOp(op);
  const [relation, setRelation] = useState<ContactRelation>(row.relation ?? 'stranger');
  const decide = async (decision: 'accept' | 'ignore'): Promise<void> => {
    const done = await contactActions.decideRequest(row, decision);
    if (done && decision === 'accept') {
      const accepted = contacts.list.data.get().value?.contacts.find((held) => held.id === row.id);
      if (accepted !== undefined && relation !== (accepted.relation ?? 'stranger')) {
        await contactActions.setRelation(accepted, relation);
      }
      onAccepted(row.id);
    }
  };
  return (
    <li className="net-request" aria-label={row.name}>
      <div className="net-request-who">
        <ContactAvatar row={row} size={44} />
        <span className="net-person-name">{row.name}
          {row.handle === null ? null : <small>@{row.handle}</small>}</span>
        {row.last === null ? null : <span className="mono nt-deadline">{clockTime(row.last.at, timeZone)}</span>}
      </div>
      {row.last === null ? null : <p className="net-request-note">{row.last.text}</p>}
      <div className="field">
        <span className="field-label">关系 <InfoTip text={RELATION_TIP} label="关系的说明" /></span>
        <div className="segmented" role="group" aria-label="关系">
          {CONTACT_RELATIONS.map((item) => (
            <button key={item} type="button" className="segmented-item" aria-pressed={relation === item}
              aria-label={CONTACT_RELATION_LABELS[item]} onClick={() => setRelation(item)}>
              {SHORT_LABELS[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="net-actions">
        <button type="button" className="primary-button" disabled={locked} onClick={() => void decide('accept')}>
          接受</button>
        <button type="button" className="chip-button" disabled={locked} onClick={() => void decide('ignore')}>
          忽略</button>
      </div>
      {op === undefined || op.status === 'running' ? null : (
        <OpLine op={op} onRetry={(key) => void contactActions.retry(key)} onDismiss={(key) => actionOps.dismiss(key)} />
      )}
    </li>
  );
}

export function ContactRequests({ onAccepted, only }: { onAccepted: (id: string) => void; only?: string })
  : ReactNode {
  const { contacts } = useLive();
  const list = useStore(contacts.list.data);
  const rows = (list.value?.contacts ?? [])
    .filter((row) => row.state === 'request' && (only === undefined || row.id === only));
  if (list.value !== null && rows.length === 0) {
    return <p className="contact-list-empty">没有新请求了</p>;
  }
  return (
    <ul className="request-list net-requests" aria-label="新请求">
      {rows.map((row) => <RequestCard key={row.id} row={row} onAccepted={onAccepted} />)}
    </ul>
  );
}
