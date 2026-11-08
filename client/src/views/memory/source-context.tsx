import type { ReactNode } from 'react';
import type { SourceContext } from '../../api/shared.ts';
import { MentionButton } from '../conversation/mention-button.tsx';
import { useClientState } from '../../state/context.tsx';
import { useRoute } from '../../shell/use-route.ts';

export function SourceContextView({ source }: { source: SourceContext | null | undefined }): ReactNode {
  const { conversationUi } = useClientState();
  const { navigate } = useRoute();
  if (source == null) { return null; }
  return <section className="mem-detail" aria-label="来源原文">
    <h4 className="block-title">来源原文</h4>
    <p className="mem-text" style={{ whiteSpace: 'pre-wrap' }}>{source.text}</p>
    {source.at === null ? null : <time className="text-meta">{source.at}</time>}
    <MentionButton type={source.kind === 'quote' ? 'memory_entry' : source.kind} id={source.ref}
      label="来源原话" text={source.text} />
    {source.kind === 'note' ? <a className="text-button" href={`#/notes/${encodeURIComponent(source.ref)}`}>
      打开原笔记</a> : null}
    {source.kind === 'message' ? <button type="button" className="text-button" onClick={() => {
      conversationUi.addQuote({ id: `source:${source.ref}`, kind: 'message', sourceId: source.ref,
        label: '来源原话', text: source.text });
      navigate({ view: 'conversation', noteId: null });
    }}>回到来源对话</button> : null}
  </section>;
}
