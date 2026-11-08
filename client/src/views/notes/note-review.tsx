import { useId, useMemo, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';
import { noteChanges, applyNoteChanges } from './note-diff.ts';
import './note-review.css';

export interface NoteProposal { base: string; candidate: string; label: string }

export function NoteReview({ proposal, current, onAdopt, onKeep, conflict = false, onUseNew, canAdopt }: {
  proposal: NoteProposal;
  current: () => string;
  onAdopt: (markdown: string) => void;
  onKeep: () => void;
  conflict?: boolean;
  onUseNew?: () => void;
  canAdopt?: () => boolean;
}): ReactNode {
  const id = useId();
  const [candidate, setCandidate] = useState(proposal.candidate);
  const changes = useMemo(() => noteChanges(proposal.base, candidate), [proposal.base, candidate]);
  const [selected, setSelected] = useState(() => new Set(changes.map((_, index) => index)));
  const [tab, setTab] = useState<'changes' | 'draft' | 'original'>('changes');
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edit = (text: string): void => {
    setCandidate(text);
    setSelected(new Set(noteChanges(proposal.base, text).map((_, index) => index)));
    setError(null);
  };
  const adopt = (): void => {
    if (composing || canAdopt?.() === false) { return; }
    try {
      onAdopt(applyNoteChanges(proposal.base, current(), changes.filter((_, index) => selected.has(index))));
    } catch (cause) { setError(errorText(cause)); setTab('changes'); }
  };
  const tabs = [['changes', `逐处比较 · ${changes.length}`], ['draft', '编辑修改稿'], ['original', '生成时原文']] as const;
  return <section className="note-review" aria-label="笔记改动对照">
    <header className="note-toolbar"><strong>{proposal.label}</strong>
      <span className="note-status">{changes.length} 处改动 · 未写回</span>
    </header>
    <div className="note-review-tabs" role="tablist" aria-label="修改稿查看方式">
      {tabs.map(([value, label]) => <button key={value} type="button" role="tab"
        id={`${id}-${value}-tab`} aria-controls={`${id}-${value}`} aria-selected={tab === value}
        className="text-button" onClick={() => setTab(value)}>{label}</button>)}
    </div>
    <div id={`${id}-changes`} role="tabpanel" aria-labelledby={`${id}-changes-tab`} hidden={tab !== 'changes'}>
      {changes.length === 0 ? <p className="note-status">两版正文相同。</p> : changes.map((change, index) =>
        <label className="note-change" key={`${change.start}:${change.end}`}>
          <span className="note-change-choice"><input type="checkbox" aria-label={`采用第 ${index + 1} 处修改`}
            checked={selected.has(index)} onChange={() => setSelected((value) => {
              const next = new Set(value);
              if (next.has(index)) { next.delete(index); } else { next.add(index); }
              return next;
            })} /><span>第 {index + 1} 处</span></span>
          <span className="note-change-pair">
            <span className="note-change-text"><span>原文</span><del>{change.before || '（空）'}</del></span>
            <span className="note-change-text"><span>修改稿</span><ins>{change.after || '（删除此处）'}</ins></span>
          </span>
        </label>)}
    </div>
    <div id={`${id}-draft`} role="tabpanel" aria-labelledby={`${id}-draft-tab`} hidden={tab !== 'draft'}>
      <textarea aria-label="修改稿" className="note-review-draft" value={candidate} rows={10}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onChange={(event) => edit(event.target.value)} />
    </div>
    <div id={`${id}-original`} role="tabpanel" aria-labelledby={`${id}-original-tab`} hidden={tab !== 'original'}>
      <pre className="note-review-original">{proposal.base}</pre>
    </div>
    {error === null ? null : <p role="alert" className="note-error">{error}</p>}
    <footer className="note-toolbar note-review-footer">
      <button type="button" className="primary-button" onClick={adopt}
        disabled={selected.size === 0 || composing}>采用所选</button>
      <span className="note-status">{selected.size} / {changes.length}</span>
      <button type="button" className="text-button" onClick={onKeep}>
        {conflict ? '保留我的' : '保留当前正文'}
      </button>
      {!conflict || onUseNew === undefined ? null :
        <button type="button" className="text-button" onClick={onUseNew}>用新版本</button>}
    </footer>
  </section>;
}
