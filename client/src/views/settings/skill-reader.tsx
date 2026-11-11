import { useEffect, useId, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import type { SkillDescriptor, SkillPage } from '../../api/shared.ts';
import { Markdown } from '../../primitives/message/markdown.tsx';

/** Keep raw text for paging; metadata belongs to the directory, not the displayed method. */
function methodText(text: string, path: string, complete: boolean): string {
  if (path !== 'SKILL.md') { return text; }
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(text);
  if (opening === null) { return text; }
  const rest = text.slice(opening[0].length);
  const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest);
  if (closing === null) { return complete ? text : ''; }
  return rest.slice(closing.index + closing[0].length);
}

export function SkillReader({ descriptor }: { descriptor: SkillDescriptor }): ReactNode {
  const api = useApi();
  const id = useId();
  const [path, setPath] = useState('SKILL.md');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<SkillPage | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setBusy(true);
    void api.skills.read(descriptor.name, { version: descriptor.version, path, offset }, controller.signal)
      .then(({ skill }) => {
        if (controller.signal.aborted) { return; }
        setPage(skill);
        setText((previous) => offset === 0 ? skill.text : Array.from(previous).slice(0, offset).join('') + skill.text);
      }).catch(() => { if (!controller.signal.aborted) { setError(true); } })
      .finally(() => { if (!controller.signal.aborted) { setBusy(false); } });
    return () => controller.abort();
  }, [api, descriptor.name, descriptor.version, path, offset, refresh]);
  return <div className="skill-reader">
    <label className="field-label" htmlFor={id}>查看技能文件</label>
    <select id={id} className="field-input" value={path} onChange={(event) => {
      setPath(event.target.value); setOffset(0); setPage(null); setText('');
    }}>
      {[...new Set(['SKILL.md', ...descriptor.resources])].map((file) => <option key={file}>{file}</option>)}
    </select>
    {busy ? <p className="tool-sub">正在读取方法…</p> : null}
    {error ? <p className="block-empty is-error" role="alert">读取技能失败。{' '}
      <button type="button" className="text-button" onClick={() => setRefresh((value) => value + 1)}>再读一次</button>
    </p> : null}
    <div className="skill-method"><Markdown text={methodText(text, path, page?.nextOffset === null)} /></div>
    {page?.nextOffset !== null && page?.nextOffset !== undefined ? <button type="button" className="text-button"
      disabled={busy || error} onClick={() => setOffset(page.nextOffset!)}>继续读取</button> : null}
    <details className="tool-group-details">
      <summary className="text-meta">来源与版本</summary>
      <p className="text-meta">{descriptor.source.origin}</p>
      <p className="text-meta">版本：{descriptor.version}</p>
      <p className="text-meta">位置：{descriptor.directory}</p>
    </details>
  </div>;
}
