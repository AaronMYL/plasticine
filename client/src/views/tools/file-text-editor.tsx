import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { FileTextView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { isOpenOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { OpLine } from '../../primitives/task-row/op-line.tsx';

export function FileTextEditor({ path, creating = false, onClose }: {
  path: string; creating?: boolean; onClose(): void;
}): ReactNode {
  const api = useApi();
  const { m5bActions } = useLive();
  const { inlineDrafts, actionOps } = useClientState();
  const drafts = useStore(inlineDrafts.store);
  const key = `files:text:${path}`;
  const op = useOp(key);
  const locked = op !== undefined && isOpenOp(op);
  const [latest, setLatest] = useState<FileTextView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (creating) { return; }
    const controller = new AbortController();
    void api.files.readText(path, controller.signal).then((value) => {
      if (controller.signal.aborted) { return; }
      setLatest(value); setError(null);
    }, (cause: unknown) => { if (!controller.signal.aborted) { setError(errorText(cause)); } });
    return () => controller.abort();
  }, [api, path, key, creating, attempt, inlineDrafts]);
  const text = drafts.get(`${key}:content`) ?? latest?.text ?? '';
  const version = creating ? null : drafts.get(`${key}:version`) ?? latest?.version ?? null;
  const changed = latest !== null && latest.version !== version;
  return <section className="inline-edit" aria-label={`文本文件 ${path}`}>
    <header className="block-head"><h3 className="block-title">{path}</h3>
      <button type="button" className="text-button" onClick={onClose}>返回文件列表</button></header>
    {error === null ? null : <p role="alert">{error}</p>}
    {op === undefined ? null : <OpLine op={op} onRetry={(key) => void m5bActions.retry(key)}
      onDismiss={(key) => actionOps.dismiss(key)} />}
    <label className="field">文本内容<textarea className="field-input file-text-content" rows={18} value={text}
      disabled={locked || (!creating && latest === null)}
      onChange={(event) => {
        if (!creating && latest !== null && !drafts.has(`${key}:version`)) {
          inlineDrafts.set(`${key}:version`, latest.version);
        }
        inlineDrafts.set(`${key}:content`, event.target.value);
      }} /></label>
    {changed ? <details open><summary>磁盘上的新版（草稿没有被覆盖）</summary><pre>{latest.text}</pre>
      <button type="button" className="text-button" onClick={() => {
        inlineDrafts.set(`${key}:version`, latest.version);
      }}>已核对新版，继续保存我的内容</button></details> : null}
    <div className="ask-options"><button type="button" className="primary-button"
      disabled={locked || changed || (!creating && latest === null)} onClick={() => void (async () => {
        if (await m5bActions.saveFileText({ path, text, version })) { onClose(); }
      })()}>保存文本</button>
      {creating ? null : <button type="button" className="text-button" disabled={locked}
        onClick={() => setAttempt((value) => value + 1)}>读取磁盘新版</button>}
    </div>
  </section>;
}
