// 「昨晚整理了什么」里的 Soul 一组（第13批，11-14 定：主线和队友每晚整理时各改自己的 Soul，改动在「昨晚整理」里列
// 前后对比、一键撤回）：这一夜自己改过的每一份一行——谁的、改了几处、改了什么（它自己写的一句），「看改动」就地展开，
// 「撤回」只在那一次之后没再改过时能点。编辑主线、编辑队友的弹框里也能看、能撤。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import { errorText } from '../../api/errors.ts';
import { SOUL_OWNER_MAIN, type MateView, type SoulResponse } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useStore } from '../../state/use-store.ts';
import { useMainIdentity } from '../mates/main-store.ts';
import { MainAvatar, MateAvatar } from '../mates/mate-avatar.tsx';
import { DiffView } from '../mates/soul-field.tsx';
import { soulOf } from '../mates/soul-name.ts';

/** 夜里的整理前后多久内自己改的算这一夜的。 */
const NIGHT_MS = 12 * 60 * 60 * 1000;

interface Row { owner: string; name: string; mate: MateView | null; value: SoulResponse }
type Read = Row | { owner: string; name: string; error: string };

function nightRevision(value: SoulResponse, finishedAt: string): SoulResponse['revisions'][number] | null {
  const end = Date.parse(finishedAt);
  return value.revisions.find((revision) => revision.actor === 'self'
    && Math.abs(Date.parse(revision.at) - end) < NIGHT_MS) ?? null;
}

function SoulRow({ row, finishedAt, onChange }: { row: Row; finishedAt: string;
  onChange: (value: SoulResponse) => void }): ReactNode {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = nightRevision(row.value, finishedAt);
  if (revision === null) return null;
  const undoable = revision.undoneAt === null && row.value.revisions[0]?.id === revision.id;
  const undo = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onChange(await api.souls.undo(row.owner, { requestId: createRequestId(), revisionId: revision.id }));
      setOpen(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="dream-row" data-undone={revision.undoneAt !== null}>
      <span className="dream-soul-avatar" aria-hidden="true">
        {row.mate === null ? <MainAvatar size={18} still /> : <MateAvatar mate={row.mate} size={18} still />}
      </span>
      <span className="dream-row-text">
        <span className="dream-row-main">{soulOf(row.name)} · 改了 {revision.changes} 处</span>
        {revision.note.trim() === '' ? null : <span className="dream-source text-meta">{revision.note}</span>}
        {open ? <DiffView owner={row.owner} revision={revision} note={false} /> : null}
        {error === null ? null : <span className="dream-row-error text-meta" role="alert">{error}</span>}
      </span>
      <span className="dream-row-actions">
        <button type="button" className="text-button text-button-quiet" aria-expanded={open}
          onClick={() => setOpen(!open)}>{open ? '收起' : '看改动'}</button>
        {revision.undoneAt !== null ? <span className="text-meta">已撤回</span> : undoable ? (
          <button type="button" className="text-button text-button-quiet" disabled={busy}
            aria-label={`撤回「${soulOf(row.name)}」这次改动`} onClick={() => void undo()}>
            <Icon name="undo" size={12} />撤回</button>
        ) : null}
      </span>
    </li>
  );
}

export function DreamSouls({ finishedAt }: { finishedAt: string }): ReactNode {
  const api = useApi();
  const live = useLive();
  const main = useMainIdentity();
  const mates = useStore(live.mates.data).mates;
  const [reads, setReads] = useState<Read[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    const wanted: { owner: string; name: string; mate: MateView | null }[] = [
      { owner: SOUL_OWNER_MAIN, name: main.name, mate: null },
      ...mates.map((mate) => ({ owner: mate.id, name: mate.name, mate }))];
    void Promise.all(wanted.map((item) => api.souls.get(item.owner, controller.signal).then(
      (value): Read => ({ ...item, value }),
      (cause: unknown): Read => ({ owner: item.owner, name: item.name, error: errorText(cause) })))).then((found) => {
      if (!controller.signal.aborted) setReads(found);
    });
    return () => controller.abort();
  }, [api, mates, main.name]);
  const changed = reads.filter((read): read is Row => 'value' in read
    && nightRevision(read.value, finishedAt) !== null);
  const failed = reads.flatMap((read) => 'error' in read ? [read] : []);
  if (changed.length === 0 && failed.length === 0) return null;
  return (
    <section className="block memory-block dream-group" aria-labelledby="dream-souls">
      <div className="memory-block-head">
        <h2 id="dream-souls" className="block-title">Soul</h2>
        <span className="block-meta text-mono">{changed.length}</span>
      </div>
      <ul className="dream-rows">
        {changed.map((row) => <SoulRow key={row.owner} row={row} finishedAt={finishedAt}
          onChange={(value) => setReads((old) => old.map((item) => item.owner === row.owner ? { ...row, value }
            : item))} />)}
      </ul>
      {failed[0] === undefined ? null : <p className="block-empty is-error" role="alert">
        没读到{failed.map((read) => soulOf(read.name)).join('、')}：{failed[0].error}</p>}
    </section>
  );
}
