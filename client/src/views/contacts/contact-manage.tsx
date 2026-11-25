import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';

export function RenameField({ row, onDone }: { row: ContactRow; onDone: () => void }): ReactNode {
  const { contactEdits } = useLive();
  const [text, setText] = useState(row.name);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  useEffect(() => {
    input.current?.select();
  }, []);
  const save = async (): Promise<void> => {
    if (saving.current) return;
    if (text.trim() === row.name) {
      onDone();
      return;
    }
    saving.current = true;
    const result = await contactEdits.rename(row, text);
    saving.current = false;
    if (result === null) onDone();
    else setProblem(result);
  };
  return (
    <span className="contact-rename">
      <input ref={input} className="field-input contact-rename-input" value={text} maxLength={40}
        aria-label={`${row.name}的备注`} aria-invalid={problem !== null} placeholder="清空就用对方自己的名字"
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            void save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
        onBlur={() => void save()} />
      {problem === null ? null : <span className="contact-rename-error" role="alert">{problem}</span>}
    </span>
  );
}

export function RemoveContactDialog({ row, onDone }: { row: ContactRow; onDone: (removed: boolean) => void })
  : ReactNode {
  const { contactEdits } = useLive();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <ConfirmDialog title={`删除「${row.name}」？`} confirmLabel="删除" busy={busy} error={problem}
      body="对方不会收到通知。聊天记录进「最近删除」，能恢复；对方再发消息会变成新的好友请求。"
      onCancel={() => onDone(false)}
      onConfirm={() => {
        setBusy(true);
        void contactEdits.remove(row).then((result) => {
          setBusy(false);
          if (result === null) onDone(true);
          else setProblem(result);
        });
      }} />
  );
}
