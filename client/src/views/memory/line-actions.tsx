// 一条记忆的改、删、挪（11-11 记忆改版，设计稿「一页记忆」）：行尾 ⋯ 里是「改」「挪到…」「删除」；改是就地换成输入框，
// 挪到…是第二层菜单列出别的几页，删除先问一句。规则页（RULES_DOC_ID）自己有一套，不走这里。
// 记忆分层（11-15 设计稿）：承诺和授权的行是另一份菜单（GrantLineActions）——看出处、修改、先停着（停着的是
// 「改成可以直接做」「改成先问你」）、收回；收回的进「已收回」，不删。

import { useEffect, useState, type ReactNode } from 'react';
import { MEMORY_SECTION_LABELS, type MemoryDocLine, type MemoryLineSection, type MemoryLineSource,
  type MemoryTopicView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { Icon } from '../../shell/icons.tsx';
import { MenuItem, Popover, type PopoverAnchor } from '../../shell/popover.tsx';
import { RevealMore, type RevealAction } from '../../shell/reveal-more.tsx';
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
    <form className="line-editor" onSubmit={(event) => {
      event.preventDefault();
      void save();
    }}>
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
      {deleting ? <ConfirmDialog title="删除这一条？" body="删除后 Plasticine 不再用它，也不会再想起来。"
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

/**
 * 「加一条」：点开是输入框，存了接在最后一节。分了段的几篇（做事经验、承诺和授权）先选加到哪一段（sections）；
 * 只有一段时不用选（主动告诉你每段下面各一个）。
 */
export function AddLine({ docId, sections, label = '加一条' }: { docId: string;
  sections?: readonly MemoryLineSection[]; label?: string }): ReactNode {
  const edits = useMemoryEdits();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<MemoryLineSection | undefined>(sections?.[0]);
  if (!open) {
    return <button type="button" className="secondary-button button-small doc-add" onClick={() => setOpen(true)}>
      <Icon name="plus" size={14} />{label}</button>;
  }
  return <div className="doc-add-form">
    {sections === undefined || sections.length < 2 ? null : (
      <span className="segmented" role="group" aria-label="加到哪一段">
        {sections.map((item) => (
          <button key={item} type="button" className="segmented-item" aria-pressed={section === item}
            onClick={() => setSection(item)}>{MEMORY_SECTION_LABELS[item]}</button>
        ))}
      </span>
    )}
    <LineEditor initial="" label="加一条记忆" onCancel={() => setOpen(false)}
      onSave={async (text) => {
        const problem = await edits.add(docId, text, section);
        if (problem === null) setOpen(false);
        return problem;
      }} />
  </div>;
}

/** 承诺和授权里一行的菜单：看出处、修改、先停着或恢复、收回（收回的还在「已收回」里，不删）。 */
export function GrantLineActions({ docId, line, section, onEdit, onSource }: { docId: string; line: MemoryDocLine;
  section: MemoryLineSection; onEdit: () => void; onSource: ((source: MemoryLineSource) => void) | null }): ReactNode {
  const edits = useMemoryEdits();
  const [error, setError] = useState<string | null>(null);
  const short = Array.from(line.text).slice(0, 12).join('');
  const source = line.sources[0];
  const to = (target: MemoryLineSection): RevealAction => ({ icon: target === 'hold' ? 'pause' : 'undo',
    label: target === 'hold' ? '先停着' : `改成${MEMORY_SECTION_LABELS[target]}`,
    onSelect: () => void edits.moveSection(docId, line, target).then(setError) });
  const moves = section === 'hold' ? [to('allow'), to('ask')] : section === 'promise' ? [] : [to('hold')];
  return (
    <>
      <RevealMore label={`「${short}」的更多操作`} actions={[
        ...(onSource === null || source === undefined || source.kind === 'system' ? []
          : [{ icon: 'search' as const, label: '看出处', onSelect: () => onSource(source) }]),
        { icon: 'edit', label: '修改', onSelect: onEdit },
        ...moves,
        { icon: 'undo', label: '收回', danger: true, onSelect: () => void edits.withdraw(docId, line).then(setError) },
      ]} />
      {error === null ? null : <span className="text-meta is-error" role="alert">{error}</span>}
    </>
  );
}
