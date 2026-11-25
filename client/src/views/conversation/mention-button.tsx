import { currentComposer } from './current-composer.ts';
import { useState, type ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { PHONE_BELOW } from '../../shell/layout.ts';
import { useViewportWidth } from '../../shell/use-viewport-width.ts';
import { IconButton } from '../../shell/icon-button.tsx';

export interface MentionTarget {
  type: string;
  id: string;
  version?: number | undefined;
  label: string;
  text: string;
}

export function useMention(): (target: MentionTarget) => void {
  const targetState = useClientState();
  const { shellPrefs } = targetState;
  const phone = useViewportWidth() < PHONE_BELOW;
  return (target) => {
    const ref = `${target.type}:${target.id}${target.version === undefined ? '' : `@${target.version}`}`;
    currentComposer(targetState).ui.addQuote({ id: `mention:${ref}`,
      kind: target.type === 'message' ? 'message' : 'object',
      sourceId: ref, label: target.label, text: `[${ref}]\n${target.text}` });
    if (phone) { shellPrefs.setPhoneChatOpen(true); }
    else { shellPrefs.setChatOpen(true); }
  };
}

export function MentionButton(props: { type: string; id: string; version?: number; label: string;
  text: string; actionLabel?: string; showLabel?: boolean }): ReactNode {
  const mention = useMention();
  const [added, setAdded] = useState(false);
  const actionLabel = added ? '已放入对话' : props.actionLabel ?? '在对话里提';
  return <IconButton icon={added ? 'check' : 'quote'} label={actionLabel}
    title={added ? '已放入对话，可补充你的问题后发送' : '将这条内容引用到对话，再补充你想讨论的问题'}
    className={`mention-button${props.showLabel ? ' chip-button mention-labeled' : ''}`} onClick={() => {
    mention(props);
    setAdded(true);
  }}><span className={props.showLabel ? undefined : 'sr-only'} role={added ? 'status' : undefined}>
    {actionLabel}
  </span></IconButton>;
}
