// 资料（第 113 条，设计稿 Main 右栏 / Phone-Contact）：头像、名字、@handle（邮件是地址）、关系分段控件（陌生人 / 合作方 /
// 朋友，接上了的人才有）、交付（每条一个状态点 + 标题 + 在做或日期）、代你说过（分身对外说过的话 + 日期）、核对安全码
// （点开是 12 组 5 位数；安全码变了时按钮前一个等你点和一句提醒）。空的小节不出现。

import { useEffect, useState, type ReactNode } from 'react';
import {
  CONTACT_RELATION_LABELS,
  CONTACT_RELATIONS,
  type ContactDetail,
  type ContactRow,
} from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { contactOpKey } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import { LoadNote } from '../m5b/load-note.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { ContactAvatar } from './contact-avatar.tsx';
import { shortDate } from './contact-time.ts';
import { deliveryDot, deliveryWord } from './task-status.ts';
import './contact-profile.css';

const DOT_LABELS = { run: '还没结', ok: '通过', err: '退回', off: '没做' } as const;

function Relation({ contact }: { contact: ContactRow }): ReactNode {
  const { contactActions } = useLive();
  const { actionOps } = useClientState();
  const op = useOp(contactOpKey(contact.id, 'relation'));
  const locked = op !== undefined && isOpenOp(op);
  return (
    <>
      <div className="segmented contact-relation" role="group" aria-label="关系">
        {CONTACT_RELATIONS.map((relation) => (
          <button key={relation} type="button" className="segmented-item" aria-pressed={contact.relation === relation}
            disabled={locked} onClick={() => void contactActions.setRelation(contact, relation)}>
            {CONTACT_RELATION_LABELS[relation]}
          </button>
        ))}
      </div>
      {op === undefined || op.status === 'running' ? null : (
        <OpLine op={op} onRetry={(key) => void contactActions.retry(key)} onDismiss={(key) => actionOps.dismiss(key)} />
      )}
    </>
  );
}

function Deliveries({ detail }: { detail: ContactDetail }): ReactNode {
  const timeZone = useTimeZone();
  if (detail.deliveries.length === 0) {
    return null;
  }
  return (
    <section className="profile-section" aria-label="交付">
      <p className="profile-label">交付</p>
      <ul className="profile-list">
        {detail.deliveries.map((entry) => {
          const dot = deliveryDot(entry.state);
          const word = deliveryWord(entry.state);
          return (
            <li key={entry.taskId}>
              <span className="profile-item" title={entry.title}>
                <span className={`dot profile-dot-${dot}`} role="img" aria-label={DOT_LABELS[dot]} />
                <span className="profile-item-text">{entry.title}</span>
              </span>
              {word === null ? <span className="mono profile-meta">{shortDate(entry.at, timeZone)}</span>
                : <span className="profile-meta">{word}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Said({ detail }: { detail: ContactDetail }): ReactNode {
  const timeZone = useTimeZone();
  if (detail.said.length === 0) {
    return null;
  }
  return (
    <section className="profile-section" aria-label="代你说过">
      <p className="profile-label">代你说过</p>
      <ul className="profile-list">
        {detail.said.map((entry) => (
          <li key={entry.id}>
            <span className="profile-item-text" title={entry.text}>{entry.text}</span>
            <span className="mono profile-meta">{shortDate(entry.at, timeZone)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SafetyCode({ detail }: { detail: ContactDetail }): ReactNode {
  const { contactActions } = useLive();
  const [open, setOpen] = useState(false);
  if (detail.safetyCode === null) {
    return null;
  }
  const groups = detail.safetyCode.split(/\s+/).filter((group) => group !== '');
  return (
    <div className="profile-safety">
      {detail.safetyChanged ? <p className="profile-safety-changed" role="alert">
        <span className="dot dot-accent" aria-hidden="true" />安全码变了，和对方核对一下</p> : null}
      <button type="button" className="chip-button profile-safety-button" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <Icon name="lock" size={14} />核对安全码
      </button>
      {open ? (
        <ol className="profile-safety-code mono" aria-label="安全码">
          {groups.map((group, index) => <li key={index}>{group}</li>)}
        </ol>
      ) : null}
      {open && detail.safetyChanged ? (
        <button type="button" className="chip-button" onClick={() => void contactActions.confirmSafety(detail.contact)}>
          核对好了
        </button>
      ) : null}
    </div>
  );
}

/** 名字下面那一行：人写 @handle，邮件写地址，系统来源不写。 */
export function subtitleOf(contact: ContactRow): string | null {
  if (contact.kind === 'person') {
    return contact.handle === null ? null : `@${contact.handle}`;
  }
  return contact.kind === 'mail' ? contact.address : null;
}

export interface ContactProfileProps {
  contact: ContactRow;
  phone: boolean;
}

export function ContactProfile({ contact, phone }: ContactProfileProps): ReactNode {
  const live = useLive();
  const resource = live.contacts.detail(contact.id);
  const detail = useStore(resource.data);
  useEffect(() => {
    resource.open();
  }, [resource]);
  const sub = subtitleOf(contact);
  const value = detail.value;
  return (
    <div className="contact-profile" data-phone={phone}>
      <div className="profile-who">
        <ContactAvatar row={contact} size={phone ? 72 : 56} />
        <div className="profile-names">
          {phone ? <h1 className="profile-name">{contact.name}</h1> : <p className="profile-name">{contact.name}</p>}
          {sub === null ? null : <p className="mono profile-handle">{sub}</p>}
        </div>
        {contact.kind === 'person' && contact.state === 'active' ? <Relation contact={contact} /> : null}
      </div>
      <LoadNote resource={detail} what="资料" onRetry={() => void resource.reload()} />
      {value === null ? null : (
        <>
          <Deliveries detail={value} />
          <Said detail={value} />
          <SafetyCode detail={value} />
        </>
      )}
    </div>
  );
}
