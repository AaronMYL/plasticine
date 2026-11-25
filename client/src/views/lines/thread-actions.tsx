import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { LINE_REACTIONS, type LineMessageView } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { MenuItem, Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';

export interface ThreadActions {
  lineId: string;
  message(seq: number): LineMessageView | undefined;
  quote(seq: number, author: string, text: string): void;
  react?: ((seq: number, emoji: string, on: boolean) => void) | undefined;
}

const ThreadActionsContext = createContext<ThreadActions | null>(null);

export const ThreadActionsProvider = ThreadActionsContext.Provider;

export function useThreadActions(): ThreadActions | null {
  return useContext(ThreadActionsContext);
}

function Reactions({ react, seq, reactions }: { react: NonNullable<ThreadActions['react']>; seq: number;
  reactions: readonly string[] }): ReactNode {
  if (reactions.length === 0) {
    return null;
  }
  return (
    <div className="line-reactions">
      {reactions.map((emoji) => (
        <button key={emoji} type="button" className="line-reaction" aria-label={`${emoji}，点了拿掉`}
          onClick={() => react(seq, emoji, false)}>{emoji}</button>
      ))}
    </div>
  );
}

type Menu = { kind: 'emoji' | 'more'; anchor: PopoverAnchor } | null;
type Copied = 'idle' | 'copied' | 'failed';

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
      {actions.react === undefined ? null : <IconButton icon="smile" size={14} label="表情" data-message-action="react"
        aria-expanded={menu?.kind === 'emoji'}
        onClick={(event) => setMenu({ kind: 'emoji', anchor: anchorOf(event.currentTarget) })} />}
      <IconButton icon="quote" size={14} label="引用这条" data-message-action="quote"
        onClick={() => actions.quote(seq, author, text)} />
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
                  actions.react?.(seq, emoji, !reactions.includes(emoji));
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

export function MessageRow({ seq, author, text, children }: { seq: number; author: string; text: string;
  children: ReactNode }): ReactNode {
  const actions = useThreadActions();
  if (actions === null) {
    return children;
  }
  const reactions = actions.react === undefined ? [] : actions.message(seq)?.reactions ?? [];
  return (
    <div className="line-msg" data-from={author === '你' ? 'me' : 'ai'} data-context-message=""
      data-message-text={text}>
      {children}
      {actions.react === undefined ? null : <Reactions react={actions.react} seq={seq} reactions={reactions} />}
      <HoverBar actions={actions} seq={seq} author={author} text={text} reactions={reactions} />
    </div>
  );
}
