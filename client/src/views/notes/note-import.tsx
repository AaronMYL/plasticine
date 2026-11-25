import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { NoteImportView } from '../../api/shared.ts';
import { noteExtensions } from './editor-extensions.ts';
import { noteChanges } from './note-diff.ts';

function Variant({ markdown }: { markdown: string }): ReactNode {
  const editor = useEditor({ extensions: noteExtensions(), content: markdown, contentType: 'markdown', editable: false,
    editorProps: { attributes: { class: 'note-prose', 'aria-label': '导入版本正文' } } });
  return <EditorContent editor={editor} />;
}

export function NoteImport({ noteId }: { noteId: string }): ReactNode {
  const api = useApi();
  const [view, setView] = useState<NoteImportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState('original');
  useEffect(() => {
    const controller = new AbortController();
    void api.notes.imported(noteId, controller.signal).then((value) => {
      if (!controller.signal.aborted) { setView(value); }
    }, (cause: unknown) => { if (!controller.signal.aborted) { setError(errorText(cause)); } });
    return () => controller.abort();
  }, [api, noteId]);
  if (error !== null) { return <p className="note-error">导入关系未读到：{error}</p>; }
  if (view === null || view.variants.length === 0 && view.mergedInto === null && view.originalIds.length === 0
      && (view.unresolvedIds?.length ?? 0) === 0) {
    return null;
  }
  const title = (id: string): string => view.links.find((link) => link.id === id)?.title ?? id;
  const shown = view.variants.find((variant) => variant.kind === selected) ?? view.variants[0];
  const original = view.variants.find((variant) => variant.kind === 'original');
  const differences = noteChanges(original?.markdown ?? '', shown?.markdown ?? '');
  return <div className="note-import">
    {(view.unresolvedIds?.length ?? 0) === 0 ? null : <p className="note-status">
      有 {view.unresolvedIds?.length} 份关联旧笔记未迁入，原始合并记录仍保留。
    </p>}
    {view.mergedInto === null ? null : <p>这份原版已合并进
      <a href={`#/notes/${encodeURIComponent(view.mergedInto)}`}>《{title(view.mergedInto)}》</a>。</p>}
    {view.originalIds.length === 0 ? null : <details><summary>合并 {view.originalIds.length} 份原版</summary>
      <ul>{view.originalIds.map((id) => <li key={id}>
        <a href={`#/notes/${encodeURIComponent(id)}`}>《{title(id)}》</a>
      </li>)}</ul>
    </details>}
    {shown === undefined ? null : <details><summary>导入的原文 / 校对 / 润色</summary>
      <div role="tablist" aria-label="导入版本" className="note-toolbar">
        {view.variants.map((variant) => <button role="tab" type="button" className="text-button" key={variant.kind}
          aria-selected={shown.kind === variant.kind} onClick={() => setSelected(variant.kind)}>
          {{ original: '原文', corrected: '校对', polished: '润色' }[variant.kind]}</button>)}
      </div>
      <Variant key={shown.kind} markdown={shown.markdown} />
      {shown.kind === 'original' ? null : <details><summary>比原文改了 {differences.length} 处</summary>
        {differences.map((change) => <div className="note-change-text" key={change.start}>
          <del>{change.before}</del><ins>{change.after}</ins>
        </div>)}
      </details>}
    </details>}
  </div>;
}
