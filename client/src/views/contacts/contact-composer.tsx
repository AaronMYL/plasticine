// 聊天底下的输入框（第 113 条；2026-11-05 设计稿 Mention）：打「@」出一个小菜单——对方本人、对方的 Plasticine、
// 我的 Plasticine（群里是每个人、每个人的 Plasticine 和我的）。挑了谁的 Plasticine，框里开头一个「@✦…的 Plasticine」
// 小签，这句就是让那个 Plasticine 在这段聊天里回答；不 @ 就是和人说话。空着时灰字是「预测一句」候选（Tab 采用）。
// 11-13 Aaron 用群聊后提的：菜单里要有群里的人（原来只有各人的 Plasticine）；一句能 @ 好几个（人写进字里，Plasticine
// 是并排的小签）；@ 后面接着打字是在菜单里找。
// Enter 发、Shift+Enter 换行、中文输入法选字时不发；小签在、字空着时按退格去掉小签。邮件联系人发 = 回最近一封。

import { theirAi } from './contact-names.ts';
import { useMainName } from '../mates/main-identity.tsx';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import { NetworkAttachmentDrafts, useNetworkAttachmentDrafts } from './network-attachment-drafts.tsx';
import './network-attachments.css';
import { FaceAvatar } from './contact-avatar.tsx';
import { setContactReply, useContactReply } from './contact-reply.ts';

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

/** 这段聊天里能 @ 谁。mainName：我的主线叫什么（第 12 批，能自己起名）。群里先列人、再列各人的 Plasticine。 */
export function mentionChoices(contact: ContactRow, mainName = 'Plasticine'): MentionChoice[] {
  if (contact.kind === 'group') {
    const members = contact.members ?? [];
    const me = members.find((member) => member.self);
    const others = members.filter((member) => !member.self);
    return [
      ...others.map((member): MentionChoice => ({ id: `person:${member.accountId}`, label: member.name,
        person: { name: member.name, avatar: member.avatar ?? null }, target: null })),
      ...others.map((member): MentionChoice => ({ id: `ai:${member.accountId}`,
        label: `${member.name}的 Plasticine`, person: null, target: { kind: 'ai', aiOf: member.accountId } })),
      ...(me === undefined ? [] : [{ id: 'mine', label: `我的 ${mainName}`, person: null,
        target: { kind: 'mine' as const, aiOf: me.accountId } }]),
    ];
  }
  if (contact.kind !== 'person') {
    return [];
  }
  return [
    { id: 'person', label: contact.name, person: { name: contact.name, avatar: contact.avatar ?? null }, target: null },
    { id: 'theirs', label: theirAi(contact), person: null, target: { kind: 'ai', aiOf: null } },
    { id: 'mine', label: `我的 ${mainName}`, person: null, target: { kind: 'mine', aiOf: null } },
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
  return mentionQuery(text, caret) === '';
}

/** 光标正在一个「@…」里（@ 在行首或空白后面，到光标之间没有空白）：返回 @ 后面已经打的字；不在就是 null。 */
export function mentionQuery(text: string, caret: number): string | null {
  const at = text.lastIndexOf('@', caret - 1);
  if (at < 0 || (at > 0 && !/\s/.test(text[at - 1] ?? ''))) {
    return null;
  }
  const typed = text.slice(at + 1, caret);
  return /\s/.test(typed) ? null : typed;
}

/** 菜单里还剩哪几项：按 @ 后面打的字找（不分大小写），已经挑成小签的 Plasticine 不再列。 */
export function matchMentions(choices: readonly MentionChoice[], typed: string, picked: readonly MentionChoice[])
  : MentionChoice[] {
  const term = typed.trim().toLocaleLowerCase();
  return choices.filter((choice) => !picked.some((entry) => entry.id === choice.id)
    && (term === '' || choice.label.toLocaleLowerCase().includes(term)));
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
  const attachments = useNetworkAttachmentDrafts(contact.id);
  const files = useRef<HTMLInputElement>(null);
  const supportsFiles = contact.kind === 'person' || contact.kind === 'group';
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const key = contactOpKey(contact.id, 'send');
  const op = useOp(key);
  // 挑成小签的 Plasticine：群里可以并排好几个，一对一只留一个（再挑就换）。
  const [targets, setTargets] = useState<readonly MentionChoice[]>([]);
  const [menu, setMenu] = useState<{ active: number; typed: string } | null>(null);
  const group = contact.kind === 'group';
  const input = useRef<HTMLTextAreaElement>(null);
  const text = drafts.get(key) ?? '';
  const locked = op !== undefined && isOpenOp(op);
  const target = targets[0] ?? null;
  const offered = target !== null || text !== '' ? null : suggestion;
  const all = mentionChoices(contact, useMainName());
  const choices = menu === null ? [] : matchMentions(all, menu.typed, group ? targets : []);
  const reply = useContactReply(contact.id);
  useEffect(() => {
    if (reply !== null) input.current?.focus();
  }, [reply]);
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
    // 把「@」和后面已经打的那几个字换掉。
    const before = text.slice(0, Math.max(0, caret - 1 - (menu?.typed.length ?? 0)));
    const after = text.slice(caret);
    setMenu(null);
    if (choice.target === null) {
      inlineDrafts.set(key, `${before}@${choice.label} ${after}`);
    } else {
      setTargets(group ? [...targets, choice] : [choice]);
      inlineDrafts.set(key, `${before}${after}`);
    }
    requestAnimationFrame(() => element?.focus());
  };
  const send = async (): Promise<void> => {
    if (locked || !attachments.ready) return;
    const kind = target?.target?.kind ?? null;
    const asked = group ? targets.flatMap((entry) => (entry.target?.aiOf == null ? [] : [entry.target.aiOf])) : [];
    const sent = await contactActions.send(contact, kind === null ? 'person' : kind, asked[0] ?? null, attachments.ids,
      reply?.id ?? null, asked.slice(1));
    if (sent) {
      setTargets([]); attachments.clear(); setContactReply(contact.id, null);
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
        setMenu({ ...menu, active: (menu.active + step + choices.length) % choices.length });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const choice = choices[menu.active];
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
    if (event.key === 'Escape' && reply !== null) {
      event.preventDefault();
      setContactReply(contact.id, null);
      return;
    }
    if (event.key === 'Backspace' && text === '' && targets.length > 0) {
      setTargets(targets.slice(0, -1));
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
  const sendDisabled = locked || !attachments.ready || text.trim() === '' && attachments.ids.length === 0;
  const label = target === null ? `发给${contact.name}` : `问${targets.map((entry) => entry.label).join('、')}`;
  return (
    <div className="contact-composer" data-phone={phone} data-has-media={attachments.rows.length > 0 || reply !== null}
      onDragOver={(event) => { if (supportsFiles && !locked) event.preventDefault(); }} onDrop={(event) => {
        if (!supportsFiles || locked) return;
        event.preventDefault(); attachments.add(Array.from(event.dataTransfer.files));
      }}>
      <div className="contact-compose-surface">
      {reply === null ? null : (
        <div className="contact-reply-chip">
          <Icon name="quote" size={12} />
          <span className="contact-reply-text">回复 {reply.author}：{reply.text}</span>
          <IconButton icon="close" size={12} label="不回这句了" onClick={() => setContactReply(contact.id, null)} />
        </div>
      )}
      <NetworkAttachmentDrafts drafts={attachments} disabled={locked} />
      <input type="file" multiple hidden ref={files} aria-label="选择消息附件" disabled={locked}
        onChange={(event) => { attachments.add(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <div className="contact-composer-row">
        {phone && onNewTask !== null ? <IconButton icon="plus" label="发任务" onClick={onNewTask} /> : null}
        <div className="contact-composer-box" data-ai={target !== null}>
          {supportsFiles ? <IconButton icon="paperclip" label="添加附件" disabled={locked}
            onClick={() => files.current?.click()} /> : null}
          {menu !== null && choices.length > 0
            ? <MentionMenu choices={choices} active={menu.active} onPick={pick} /> : null}
          {targets.length === 0 ? null : <span className="composer-mentions">{targets.map((entry) => (
            <span key={entry.id} className="composer-mention">@<AiMark label={entry.label} />{entry.label}</span>
          ))}</span>}
          <textarea ref={input} className="contact-composer-input" rows={1} value={text} disabled={locked}
            aria-label={label} placeholder={target === null ? placeholderOf(contact, offered) : ''}
            onChange={(event) => {
              inlineDrafts.set(key, event.target.value);
              const typed = mentionQuery(event.target.value, event.target.selectionStart);
              setMenu(typed === null ? null : { active: 0, typed });
              grow();
            }}
            onPaste={(event) => {
              if (!supportsFiles || locked || event.clipboardData.files.length === 0) return;
              event.preventDefault(); attachments.add(Array.from(event.clipboardData.files));
            }}
            onBlur={() => setMenu(null)}
            onKeyDown={onKey} />
          {offered !== null && !phone ? <span className="contact-composer-key mono" aria-hidden="true">Tab</span>
            : null}
          {phone ? null : <SendButton disabled={sendDisabled} onSend={() => void send()} />}
        </div>
        {phone ? <SendButton disabled={sendDisabled} onSend={() => void send()} /> : null}
      </div>
      </div>
      {op === undefined || op.status === 'running' ? null : (
        <OpLine op={op} onRetry={(retryKey) => { void contactActions.retry(retryKey).then(() => {
          if (actionOps.get(retryKey) === undefined) attachments.clear();
        }); }}
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
