// 在空间里直接改（第 6 条）：结论大标题、小节标题、正文都能改；图表、图片、引用来自存下来的数据和出处，不在这里手改
// （让 Plasticine 接着改）。笔记 AI 的续写和补充在这里也能用：光标停在哪一段，就对那一段续写或补一句，采用了才进正文。

import { useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import type { NoteAssistView, SpaceBlock, SpaceDoc, SpaceView } from '../../api/shared.ts';
import { AiMark } from '../../shell/glyph.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { SpaceBlocks } from './space-blocks.tsx';

interface Suggestion {
  index: number;
  view: NoteAssistView;
}

function TextArea({ value, label, onChange, onFocus, big = false }: { value: string; label: string;
  onChange: (value: string) => void; onFocus?: () => void; big?: boolean }): ReactNode {
  return <textarea className={big ? 'space-edit-headline' : 'space-edit-text'} aria-label={label} value={value}
    rows={big ? 2 : Math.max(2, value.split('\n').length + 1)} onFocus={onFocus}
    onChange={(event) => onChange(event.target.value)} />;
}

function EditBlock({ block, index, onChange, onFocus }: { block: SpaceBlock; index: number;
  onChange: (block: SpaceBlock) => void; onFocus: () => void }): ReactNode {
  if (block.type === 'heading') {
    return <input className="space-edit-heading" aria-label={`第 ${index + 1} 块：小节标题`} value={block.text}
      onChange={(event) => onChange({ ...block, text: event.target.value })} />;
  }
  if (block.type === 'text') {
    return <TextArea label={`第 ${index + 1} 块：正文`} value={block.markdown} onFocus={onFocus}
      onChange={(markdown) => onChange({ ...block, markdown })} />;
  }
  // 图表、图片、引用照原样显示：数据和出处不手改。
  return <div className="space-edit-fixed"><SpaceBlocks doc={{ stats: [], sources: [], blocks: [block] }} /></div>;
}

export interface SpaceEditorProps {
  space: SpaceView;
  onSaved: (next: SpaceView) => void;
  onCancel: () => void;
}

export function SpaceEditor({ space, onSaved, onCancel }: SpaceEditorProps): ReactNode {
  const api = useApi();
  const [doc, setDoc] = useState<SpaceDoc>(() => structuredClone(space.doc));
  const [focused, setFocused] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState<'save' | 'assist' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setBlock = (index: number, block: SpaceBlock): void =>
    setDoc((current) => ({ ...current, blocks: current.blocks.map((item, at) => (at === index ? block : item)) }));
  const focusedText = focused === null ? undefined : doc.blocks[focused];
  const assist = (action: 'predict' | 'interject'): void => {
    if (focused === null || focusedText?.type !== 'text') {
      return;
    }
    const index = focused;
    setBusy('assist');
    setError(null);
    void api.spaces.assist(space.id, { action, markdown: focusedText.markdown, before: focusedText.markdown,
      after: '' }).then((view) => setSuggestion({ index, view }), (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(null));
  };
  const accept = (): void => {
    const block = suggestion === null ? undefined : doc.blocks[suggestion.index];
    if (suggestion === null || block?.type !== 'text') {
      return;
    }
    const joiner = suggestion.view.label === '续写' ? '' : '\n\n';
    setBlock(suggestion.index, { ...block, markdown: `${block.markdown}${joiner}${suggestion.view.markdown}` });
    setSuggestion(null);
  };
  const save = (): void => {
    setBusy('save');
    setError(null);
    void api.spaces.save(space.id, { requestId: createRequestId(), version: space.version, doc })
      .then(onSaved, (cause: unknown) => setError(errorText(cause))).finally(() => setBusy(null));
  };
  return (
    <div className="space-editor">
      <div className="space-edit-bar" role="toolbar" aria-label="编辑空间">
        <IconButton icon="forward" label="续写" disabled={focusedText?.type !== 'text' || busy !== null}
          onClick={() => assist('predict')} />
        <IconButton icon="sparkles" label="补充一句" disabled={focusedText?.type !== 'text' || busy !== null}
          onClick={() => assist('interject')} />
        <span className="grow" />
        <button type="button" className="text-button text-button-quiet" onClick={onCancel}>不改了</button>
        <button type="button" className="primary-button" disabled={busy === 'save'} onClick={save}>
          {busy === 'save' ? '正在保存…' : '保存'}</button>
      </div>
      {error === null ? null : <p className="space-edit-error" role="alert">{error}</p>}
      <TextArea big label="结论" value={doc.headline ?? space.title}
        onChange={(headline) => setDoc((current) => ({ ...current, headline }))} />
      {doc.blocks.map((block, index) => <div key={index} className="space-edit-block">
        <EditBlock block={block} index={index} onFocus={() => setFocused(index)}
          onChange={(next) => setBlock(index, next)} />
        {suggestion?.index === index ? <div className="space-suggestion by-ai" role="status">
          <AiMark /><p>{suggestion.view.markdown}</p>
          <button type="button" className="secondary-button" onClick={accept}>采用</button>
          <button type="button" className="text-button text-button-quiet" onClick={() => setSuggestion(null)}>不要</button>
        </div> : null}
      </div>)}
    </div>
  );
}
