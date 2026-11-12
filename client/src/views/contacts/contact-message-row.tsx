// 第 12 批：人和人聊天（联系人、群）里一句话的外壳——正文、下面的表情、悬停条「表情 · 引用这条 · 更多」。
// 表情对方也看得到（同一个表情点一下加、再点拿掉）；「引用这条」= 回这一句，输入框上方出一片「回复 某某：……」。
// 右键菜单（shell/context-menu.tsx）认 data-context-message 和这里的 data-message-action 按钮。手机没有悬停：
// 点一下这句（拿到焦点）悬停条才出来。

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ContactMessageView } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { MenuItem, Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { REACTIONS, type Reaction } from './contact-edits.ts';

export interface ContactMessageActions {
  /** 这句是谁说的（引用片上写名字）。 */
  authorOf(message: ContactMessageView): string;
  quote(message: ContactMessageView): void;
  react(message: ContactMessageView, emoji: Reaction, on: boolean): void;
}

const Context = createContext<ContactMessageActions | null>(null);
export const ContactMessageActionsProvider = Context.Provider;

/** 「已复制」的勾停多久。 */
const COPIED_SHOWN_MS = 1600;

/** 气泡里「回复 小林：……」那一行。 */
export function ReplyLine({ reply }: { reply: NonNullable<ContactMessageView['replyTo']> }): ReactNode {
  return (
    <span className="cm-reply">
      <Icon name="quote" size={12} />
      <span className="cm-reply-text">{reply.author}：{reply.text}</span>
    </span>
  );
}

type Reactions = NonNullable<ContactMessageView['reactions']>;

function Chips({ message, reactions, react }: { message: ContactMessageView; reactions: Reactions;
  react: ContactMessageActions['react'] }): ReactNode {
  if (reactions.length === 0) return null;
  return (
    <div className="cm-reactions">
      {reactions.map((reaction) => (
        <button key={reaction.emoji} type="button" className="cm-reaction" aria-pressed={reaction.mine}
          aria-label={`${reaction.emoji} ${reaction.count}${reaction.mine ? '，点了拿掉我的' : '，点了也加一个'}`}
          onClick={() => react(message, reaction.emoji as Reaction, !reaction.mine)}>
          <span>{reaction.emoji}</span>
          {reaction.count > 1 ? <span className="mono">{reaction.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

type Menu = { kind: 'emoji' | 'more'; anchor: PopoverAnchor } | null;

function HoverBar({ actions, message, mine }: { actions: ContactMessageActions; message: ContactMessageView;
  mine: ReadonlySet<string> }): ReactNode {
  const [menu, setMenu] = useState<Menu>(null);
  const [copied, setCopied] = useState(false);
  const close = (): void => setMenu(null);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
    } catch (cause) {
      console.warn('复制这句没写进剪贴板', cause);
    }
  };
  return (
    <div className="cm-hoverbar" data-open={menu !== null || copied ? 'true' : undefined}>
      <IconButton icon="smile" size={14} label="加个表情" data-message-action="react"
        aria-expanded={menu?.kind === 'emoji'}
        onClick={(event) => setMenu({ kind: 'emoji', anchor: anchorOf(event.currentTarget) })} />
      <IconButton icon="quote" size={14} label="引用这条" data-message-action="quote"
        onClick={() => actions.quote(message)} />
      <IconButton icon={copied ? 'check' : 'more'} size={14} label={copied ? '已复制' : '更多'}
        aria-expanded={menu?.kind === 'more'}
        onClick={(event) => setMenu({ kind: 'more', anchor: anchorOf(event.currentTarget) })} />
      {copied ? <span className="sr-only" role="status">已复制到剪贴板</span> : null}
      {menu?.kind === 'emoji' ? (
        <Popover anchor={menu.anchor} role="menu" align="end" label="加一个表情" onClose={close}>
          <div className="line-emoji-menu">
            {REACTIONS.map((emoji) => (
              <button key={emoji} type="button" role="menuitem" className="line-emoji" aria-label={emoji}
                aria-pressed={mine.has(emoji)} onClick={() => {
                  close();
                  actions.react(message, emoji, !mine.has(emoji));
                }}>{emoji}</button>
            ))}
          </div>
        </Popover>
      ) : null}
      {menu?.kind === 'more' ? (
        <Popover anchor={menu.anchor} role="menu" align="end" label="这句的更多操作" onClose={close}>
          <MenuItem icon="copy" label="复制" onSelect={() => {
            close();
            void copy();
          }} />
        </Popover>
      ) : null}
    </div>
  );
}

/** 一句人话的外壳；没有上下文（AI↔AI 摊开的那段）或还没发出去的，只画正文。 */
export function MessageShell({ message, children }: { message: ContactMessageView; children: ReactNode })
  : ReactNode {
  const actions = useContext(Context);
  const human = message.author === 'me' || message.author === 'them';
  if (actions === null || !human || message.status === 'sending' || message.status === 'failed') {
    return children;
  }
  const reactions = message.reactions ?? [];
  const mine = new Set(reactions.filter((reaction) => reaction.mine).map((reaction) => reaction.emoji));
  return (
    <div className="cm-row" data-side={message.author === 'me' ? 'me' : 'them'} tabIndex={-1}
      data-context-message="" data-message-text={message.text}>
      {children}
      <Chips message={message} reactions={reactions} react={actions.react} />
      <HoverBar actions={actions} message={message} mine={mine} />
    </div>
  );
}
