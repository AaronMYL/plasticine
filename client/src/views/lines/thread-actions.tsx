// 一条消息上能做的事（《优化清单》第 17 条借鉴 Muse，设计稿 Plasticine-Main）：鼠标停在一条消息上出现表情、回复、
// 更多三个按钮；表情就是给那一条加一个反应（存下来，显示在那条下面，点了拿掉）；回复把那一条放到输入框上面；
// 更多里可以复制全文。对话以外（工作详情里的回答）没有这个上下文，照旧只画正文。
// 复制的是这一条的全文（回复引用的才是第一行摘要）；写进剪贴板后「更多」那颗换成勾、读屏念「已复制到剪贴板」，
// 和气泡上原来的复制同一个回执样子（copy-message.tsx），停一会儿再换回来；写不进就就地一行原因。

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LINE_REACTIONS, replyExcerpt, type LineMessageView } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { MenuItem, Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';

export interface ThreadActions {
  lineId: string;
  message(seq: number): LineMessageView | undefined;
  reply(seq: number, author: string, text: string): void;
  react(seq: number, emoji: string, on: boolean): void;
}

const ThreadActionsContext = createContext<ThreadActions | null>(null);

export const ThreadActionsProvider = ThreadActionsContext.Provider;

export function useThreadActions(): ThreadActions | null {
  return useContext(ThreadActionsContext);
}

function Reactions({ actions, seq, reactions }: { actions: ThreadActions; seq: number;
  reactions: readonly string[] }): ReactNode {
  if (reactions.length === 0) {
    return null;
  }
  return (
    <div className="line-reactions">
      {reactions.map((emoji) => (
        <button key={emoji} type="button" className="line-reaction" aria-label={`${emoji}，点了拿掉`}
          onClick={() => actions.react(seq, emoji, false)}>{emoji}</button>
      ))}
    </div>
  );
}

type Menu = { kind: 'emoji' | 'more'; anchor: PopoverAnchor } | null;
type Copied = 'idle' | 'copied' | 'failed';

/** 「已复制」的勾停多久（和工具栏按钮的回执差不多，看得见又不赖着）。 */
export const COPIED_SHOWN_MS = 1600;

function HoverBar({ actions, seq, author, text, reactions }: { actions: ThreadActions; seq: number; author: string;
  text: string; reactions: readonly string[] }): ReactNode {
  const [menu, setMenu] = useState<Menu>(null);
  const [copied, setCopied] = useState<Copied>('idle');
  const close = (): void => setMenu(null);
  useEffect(() => {
    if (copied !== 'copied') return undefined;
    const timer = window.setTimeout(() => setCopied('idle'), COPIED_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch (cause) {
      console.warn('复制这条消息没写进剪贴板', cause);
      setCopied('failed');
    }
  };
  const open = menu !== null || copied !== 'idle';
  return (
    <div className="line-hoverbar" data-open={open ? 'true' : undefined}>
      <IconButton icon="smile" size={14} label="表情" aria-expanded={menu?.kind === 'emoji'}
        onClick={(event) => setMenu({ kind: 'emoji', anchor: anchorOf(event.currentTarget) })} />
      <IconButton icon="reply" size={14} label="回复这条"
        onClick={() => actions.reply(seq, author, replyExcerpt(text))} />
      <IconButton icon={copied === 'copied' ? 'check' : 'more'} size={14}
        label={copied === 'copied' ? '已复制' : '更多'} aria-expanded={menu?.kind === 'more'}
        onClick={(event) => {
          setCopied('idle');
          setMenu({ kind: 'more', anchor: anchorOf(event.currentTarget) });
        }} />
      {copied === 'copied' ? <span className="sr-only" role="status">已复制到剪贴板</span> : null}
      {copied === 'failed' ? (
        <span className="line-copy-error" role="alert">无法复制，请选中文字手动复制。
          <button type="button" className="text-button" onClick={() => setCopied('idle')}>知道了</button>
        </span>
      ) : null}
      {menu?.kind === 'emoji' ? (
        <Popover anchor={menu.anchor} role="menu" align="end" label="加一个表情" onClose={close}>
          <div className="line-emoji-menu">
            {LINE_REACTIONS.map((emoji) => (
              <button key={emoji} type="button" role="menuitem" className="line-emoji" aria-label={emoji}
                aria-pressed={reactions.includes(emoji)} onClick={() => {
                  close();
                  actions.react(seq, emoji, !reactions.includes(emoji));
                }}>{emoji}</button>
            ))}
          </div>
        </Popover>
      ) : null}
      {menu?.kind === 'more' ? (
        <Popover anchor={menu.anchor} role="menu" align="end" label="这条消息的更多操作" onClose={close}>
          <MenuItem icon="copy" label="复制" onSelect={() => {
            close();
            void copy();
          }} />

        </Popover>
      ) : null}
    </div>
  );
}

/**
 * 一条消息的外壳：正文 + 下面的表情 + 悬停条。author 是「你」或「Plasticine」，回复时写进「回复 Plasticine：……」。
 * 没有对话上下文（工作详情）时只画正文。
 */
export function MessageRow({ seq, author, text, children }: { seq: number; author: string; text: string;
  children: ReactNode }): ReactNode {
  const actions = useThreadActions();
  if (actions === null) {
    return children;
  }
  const reactions = actions.message(seq)?.reactions ?? [];
  return (
    <div className="line-msg" data-from={author === '你' ? 'me' : 'ai'}>
      {children}
      <Reactions actions={actions} seq={seq} reactions={reactions} />
      <HoverBar actions={actions} seq={seq} author={author} text={text} reactions={reactions} />
    </div>
  );
}
