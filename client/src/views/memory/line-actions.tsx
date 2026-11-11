// 一条记忆的改、删、挪（11-11 记忆改版，设计稿「一页记忆」）：行尾 ⋯ 里是「改」「挪到…」「删除」；改是就地换成输入框，
// 挪到…是第二层菜单列出别的几页，删除先问一句。规则页（RULES_DOC_ID）自己有一套，不走这里。

import { useEffect, useState, type ReactNode } from 'react';
import type { MemoryDocLine, MemoryTopicView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { MenuItem, Popover, type PopoverAnchor } from '../../shell/popover.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { useStore } from '../../state/use-store.ts';
import { useMemoryEdits } from './use-memory-edits.ts';

/** 能挪去的几页：目录里除了这一页的（规则页的行有范围，挪进去走规则页自己的加一条）。 */
function useTargets(docId: string): MemoryTopicView[] {
  const live = useLive();
  const list = useStore(live.memoryTopics.data).list;
  // 直接打开一页时目录可能还没读：读一次，菜单里才列得出别的几页。
  useEffect(() => { if (list === null) void live.memoryTopics.open(); }, [list, live.memoryTopics]);
  return (list?.groups ?? []).flatMap((group) => group.topics).filter((topic) => topic.id !== docId);
}

export function LineEditor({ initial, label, onSave, onCancel }: { initial: string; label: string;
  onSave: (text: string) => Promise<string | null>; onCancel: () => void }): ReactNode {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    if (text.trim() === '' || busy) return;
    setBusy(true);
    const problem = await onSave(text.trim());
    setBusy(false);
    setError(problem);
  };
  return (
    <form className="line-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <textarea className="field-input" aria-label={label} value={text} rows={2} autoFocus maxLength={600}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }} />
      <div className="line-editor-actions">
        {error === null ? null : <span className="text-meta is-error" role="alert">{error}</span>}
        <button type="button" className="secondary-button button-small" onClick={onCancel}>取消</button>
        <button type="submit" className="primary-button button-small" disabled={busy || text.trim() === ''}>保存</button>
      </div>
    </form>
  );
}

export function LineActions({ docId, line, onEdit }: { docId: string; line: MemoryDocLine; onEdit: () => void }):
  ReactNode {
  const edits = useMemoryEdits();
  const targets = useTargets(docId);
  const [moving, setMoving] = useState<PopoverAnchor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = Array.from(line.text).slice(0, 12).join('');
  return (
    <>
      <RevealMore label={`「${short}」的更多操作`} actions={[
        { icon: 'edit', label: '修改', onSelect: onEdit },
        { icon: 'folder', label: '挪到…', disabled: targets.length === 0, onSelect: (anchor) => setMoving(anchor) },
        { icon: 'trash', label: '删除', danger: true, onSelect: () => setDeleting(true) },
      ]} />
      {moving === null ? null : (
        <Popover anchor={moving} label="挪到哪一页" role="menu" align="end" onClose={() => setMoving(null)}>
          {targets.map((target) => (
            <MenuItem key={target.id} icon="folder" label={target.title} onSelect={() => {
              setMoving(null);
              void edits.move(docId, line, target.id).then(setError);
            }} />
          ))}
        </Popover>
      )}
      {deleting ? <ConfirmDialog title="删除这一条？" body="删掉后 Plasticine 不再用它，也不会再想起来。"
        confirmLabel="删除" busy={busy} error={error} onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setBusy(true);
          void edits.remove(docId, line).then((problem) => {
            setBusy(false);
            setError(problem);
            if (problem === null) setDeleting(false);
          });
        }} /> : null}
      {error === null || deleting ? null : <span className="text-meta is-error" role="alert">{error}</span>}
    </>
  );
}
