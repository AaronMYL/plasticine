// 聊天底下的输入框（第 113 条；2026-11-05 设计稿 Mention）：打「@」出一个小菜单——对方本人、对方的 Plasticine、
// 我的 Plasticine（群里是每个人的 Plasticine 和我的）。挑了谁的 Plasticine，框里开头一个「@✦…的 Plasticine」小签，
// 这句就是让那个 Plasticine 在这段聊天里回答；不 @ 就是和人说话。空着时灰字是「预测一句」候选（Tab 采用）。
// Enter 发、Shift+Enter 换行、中文输入法选字时不发；小签在、字空着时按退格去掉小签。邮件联系人发 = 回最近一封。

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { contactOpKey } from '../../state/contacts-action-requests.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOp } from '../pending/pending-ops.tsx';
import { FaceAvatar } from './contact-avatar.tsx';

/** 输入框最多长到这么高（px），再多就在框里滚。 */
const COMPOSER_MAX_HEIGHT = 160;

export interface ContactComposerProps {
  contact: ContactRow;
  suggestion: string | null;
  phone: boolean;
  onNewTask: (() => void) | null;
}

/** @ 菜单里的一项：一个人（只是点名，不改发给谁），或者谁的 Plasticine。 */
export interface MentionChoice {
  id: string;
  label: string;
  /** 人：名字和头像；AI：画 ✦。 */
  person: { name: string; avatar: string | null } | null;
  target: { kind: 'ai' | 'mine'; aiOf: string | null } | null;
}

/** 这段聊天里能 @ 谁。 */
export function mentionChoices(contact: ContactRow): MentionChoice[] {
  if (contact.kind === 'group') {
    const members = contact.members ?? [];
    const me = members.find((member) => member.self);
    return [
      ...members.filter((member) => !member.self).map((member): MentionChoice => ({ id: `ai:${member.accountId}`,
        label: `${member.name}的 Plasticine`, person: null, target: { kind: 'ai', aiOf: member.accountId } })),
      ...(me === undefined ? [] : [{ id: 'mine', label: '我的 Plasticine', person: null,
        target: { kind: 'mine' as const, aiOf: me.accountId } }]),
    ];
  }
  if (contact.kind !== 'person') {
    return [];
  }
  return [
    { id: 'person', label: contact.name, person: { name: contact.name, avatar: contact.avatar ?? null }, target: null },
    { id: 'theirs', label: `${contact.name}的 Plasticine`, person: null, target: { kind: 'ai', aiOf: null } },
    { id: 'mine', label: '我的 Plasticine', person: null, target: { kind: 'mine', aiOf: null } },
  ];
}

function placeholderOf(contact: ContactRow, suggestion: string | null): string {
  if (suggestion !== null) {
    return suggestion;
  }
  const gap = /^[A-Za-z0-9]/.test(contact.name) ? ' ' : '';
  return contact.kind === 'mail' ? `回 ${contact.name}` : `发给${gap}${contact.name}`;
}

/** 光标前面刚打了一个「@」（行首或空白后面）。 */
export function startsMention(text: string, caret: number): boolean {
  if (caret < 1 || text[caret - 1] !== '@') {
    return false;
  }
  return caret === 1 || /\s/.test(text[caret - 2] ?? '');
}

function MentionMenu({ choices, active, onPick }: { choices: readonly MentionChoice[]; active: number;
  onPick: (choice: MentionChoice) => void }): ReactNode {
  return (
    <div className="mention-menu" role="listbox" aria-label="@ 联系人">
      {choices.map((choice, index) => (
        <button key={choice.id} type="button" role="option" aria-selected={index === active}
          className="mention-option" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(choice)}>
          {choice.person === null
            ? <span className="mention-ai-face"><AiMark label={choice.label} /></span>
            : <FaceAvatar name={choice.person.name} avatar={choice.person.avatar} size={28} />}
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function ContactComposer({ contact, suggestion, phone, onNewTask }: ContactComposerProps): ReactNode {
  const { contactActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const key = contactOpKey(contact.id, 'send');
  const op = useOp(key);
  const [target, setTarget] = useState<MentionChoice | null>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const text = drafts.get(key) ?? '';
  const locked = op !== undefined && isOpenOp(op);
  const offered = target !== null || text !== '' ? null : suggestion;
  const choices = mentionChoices(contact);
  const grow = (): void => {
    const element = input.current;
    if (element === null) {
      return;
    }
    element.style.height = 'auto';
    element.style.height = `${Math.min(COMPOSER_MAX_HEIGHT, element.scrollHeight)}px`;
  };
  const pick = (choice: MentionChoice): void => {
    const element = input.current;
    const caret = element?.selectionStart ?? text.length;
    const before = text.slice(0, Math.max(0, caret - 1));
    const after = text.slice(caret);
    setMenu(null);
    if (choice.target === null) {
      inlineDrafts.set(key, `${before}@${choice.label} ${after}`);
    } else {
      setTarget(choice);
      inlineDrafts.set(key, `${before}${after}`);
    }
    requestAnimationFrame(() => element?.focus());
  };
  const send = async (): Promise<void> => {
    const kind = target?.target?.kind ?? null;
    const aiOf = contact.kind === 'group' ? target?.target?.aiOf ?? null : null;
    const sent = await contactActions.send(contact, kind === null ? 'person' : kind, aiOf);
    if (sent) {
      setTarget(null);
      requestAnimationFrame(grow);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (menu !== null && choices.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setMenu((menu + step + choices.length) % choices.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const choice = choices[menu];
        if (choice !== undefined) {
          pick(choice);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (event.key === 'Backspace' && text === '' && target !== null) {
      setTarget(null);
      return;
    }
    if (event.key === 'Tab' && offered !== null) {
      event.preventDefault();
      inlineDrafts.set(key, offered);
      requestAnimationFrame(grow);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };
  const label = target === null ? `发给${contact.name}` : `问${target.label}`;
  return (
    <div className="contact-composer" data-phone={phone}>
      <div className="contact-composer-row">
        {phone && onNewTask !== null ? <IconButton icon="plus" label="发任务" onClick={onNewTask} /> : null}
        <div className="contact-composer-box" data-ai={target !== null}>
          {menu !== null && choices.length > 0 ? <MentionMenu choices={choices} active={menu} onPick={pick} /> : null}
          {target === null ? null : (
            <span className="composer-mention">@<AiMark label={target.label} />{target.label}</span>
          )}
          <textarea ref={input} className="contact-composer-input" rows={1} value={text} disabled={locked}
            aria-label={label} placeholder={target === null ? placeholderOf(contact, offered) : ''}
            onChange={(event) => {
              inlineDrafts.set(key, event.target.value);
              setMenu(startsMention(event.target.value, event.target.selectionStart) ? 0 : null);
              grow();
            }}
            onBlur={() => setMenu(null)}
            onKeyDown={onKey} />
          {offered !== null && !phone ? <span className="contact-composer-key mono" aria-hidden="true">Tab</span>
            : null}
          {phone ? null : <SendButton disabled={locked || text.trim() === ''} onSend={() => void send()} />}
        </div>
        {phone ? <SendButton disabled={locked || text.trim() === ''} onSend={() => void send()} /> : null}
      </div>
      {op === undefined || op.status === 'running' ? null : (
        <OpLine op={op} onRetry={(retryKey) => void contactActions.retry(retryKey)}
          onDismiss={(dismissKey) => actionOps.dismiss(dismissKey)} />
      )}
    </div>
  );
}

function SendButton({ disabled, onSend }: { disabled: boolean; onSend: () => void }): ReactNode {
  return (
    <button type="button" className="contact-send" aria-label="发送" disabled={disabled} onClick={onSend}>
      <Icon name="send" size={16} />
    </button>
  );
}
