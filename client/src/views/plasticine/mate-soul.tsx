import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { purposeInfo } from '../../api/shared.ts';
import type { MateView, SoulLine } from '../../api/shared.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { Icon } from '../../shell/icons.tsx';
import { MATE_SOUL_HEADINGS, readMateSoul, writeMateSoul, type MateSoulFields } from './mate-soul-text.ts';

function MateSoulBody({ mate, lines, onSaved }: { mate: MateView; lines: readonly SoulLine[];
  onSaved: (mate: MateView) => void }): ReactNode {
  const api = useApi();
  const { actionOps } = useClientState();
  const operations = useStore(actionOps.store);
  const key = `mates:update:${mate.id}`;
  const operation = operations.find((item) => item.key === key);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<MateSoulFields>(() => readMateSoul(mate.soul, mate.role));
  const busy = operation !== undefined && operation.status !== 'failed';
  const display = readMateSoul(mate.soul, mate.role);
  const transmit = async (retry: boolean): Promise<void> => {
    const request = retry ? actionOps.retry(key) : actionOps.begin(key, '更新队友', mate.name,
      (requestId) => ({ kind: 'mate_update', mateId: mate.id,
        body: { requestId, version: mate.version, soul: writeMateSoul(fields) } }), createRequestId);
    if (request?.kind !== 'mate_update') return;
    try {
      onSaved(await api.mates.update(mate.id, request.body));
      actionOps.succeed(key);
      setEditing(false);
    } catch (cause) { actionOps.fail(key, cause); }
  };
  return <>
    <details className="soul-inherited"><summary><Icon name="chevron-right" size={14} />接着主线的 Soul
      <span>{lines.length} 条</span></summary>
      <ul>{lines.map((line) => <li key={line.id}>{line.text}</li>)}</ul></details>
    {operation?.error == null ? null : <p role="alert" className="soul-error">{operation.error}
      {operation.status === 'failed' ? null : <button className="text-button"
        onClick={() => void transmit(true)}>
        {operation.status === 'uncertain' ? '再核实' : '重发'}</button>}</p>}
    {editing ? <form className="mate-soul-editor"
      onSubmit={(event) => { event.preventDefault(); void transmit(false); }}>
      {MATE_SOUL_HEADINGS.map((heading) => <label key={heading}>{heading}
        <textarea aria-label={heading} rows={heading === '角色' ? 2 : 3} value={fields[heading]} disabled={busy}
          maxLength={5000} onChange={(event) => setFields((previous) => ({ ...previous,
            [heading]: event.target.value }))} /></label>)}
      <div className="soul-editor-actions"><button type="button" className="text-button" disabled={busy}
        onClick={() => setEditing(false)}>取消</button>
      <button className="chip-button" type="submit" disabled={busy}>保存队友 Soul</button></div>
    </form> : <>
      {MATE_SOUL_HEADINGS.map((heading) => <section className="mate-soul-section" key={heading}>
        <h3>{heading}{heading === '队友独有' ? <span>和主线不同</span> : null}</h3>
        <button className="mate-soul-text" aria-label={`编辑队友${heading}`} onClick={() => {
          setFields(display); setEditing(true);
        }}>{display[heading] || '添加内容'}</button>
      </section>)}
    </>}
    <footer className="mate-soul-footer"><span>模型</span>
      <span>{mate.purpose === null ? '跟主线' : purposeInfo(mate.purpose).label}</span></footer>
  </>;
}

export function MateSoul({ mateId, lines }: { mateId?: string; lines: readonly SoulLine[] }): ReactNode {
  const api = useApi();
  const aside = useRef<HTMLElement>(null);
  const [mates, setMates] = useState<MateView[]>([]);
  const [selected, setSelected] = useState<string | null>(mateId ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSelected(mateId ?? null); }, [mateId]);
  useEffect(() => {
    const controller = new AbortController();
    void api.mates.list(controller.signal).then((result) => {
      if (!controller.signal.aborted) setMates(result.mates.filter((mate) => mate.disabledAt === null));
    }, (cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [api]);
  const mate = mates.find((item) => item.id === selected) ?? (selected === null ? mates[0] : undefined);
  const ready = mate !== undefined;
  useEffect(() => {
    if (mateId !== undefined && ready && window.innerWidth <= 700) aside.current?.scrollIntoView({ block: 'start' });
  }, [mateId, ready]);
  if (mates.length === 0 && error === null) return null;
  return <aside ref={aside} className="mate-soul" aria-label="队友的 Soul">
    {error === null ? null : <p role="alert">{error}</p>}
    <header className="mate-soul-head">
      {mate === undefined ? null : <span className="mate-soul-avatar"
        style={{ '--tile-hue': `var(--hue-${mate.hue})` } as CSSProperties}>{mate.avatar}</span>}
      <div><select aria-label="选择队友" value={mate?.id ?? ''} onChange={(event) => setSelected(event.target.value)}>
        {mates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <p>队友的 Soul</p></div>
    </header>
    {mate === undefined ? <p className="text-meta">这位队友已停用或不存在。</p> : <MateSoulBody key={mate.id}
      mate={mate} lines={lines} onSaved={(next) => setMates((previous) => previous.map((item) =>
        item.id === next.id ? next : item))} />}
  </aside>;
}
