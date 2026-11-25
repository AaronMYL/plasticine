import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { LayersMoveItemView, LayersMoveView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { PageLoading } from '../../primitives/page-loading/index.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PageHeader } from '../../shell/page-header.tsx';
import type { Route } from '../../shell/routes.ts';
import './topics.css';
import './layers.css';

export function useLayersMove(): { move: LayersMoveView | null; loaded: boolean; error: string | null;
  busy: boolean; undo: (lineIds?: string[]) => void } {
  const api = useApi();
  const live = useLive();
  const [move, setMove] = useState<LayersMoveView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api.memoryTopics.layersMove(controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setMove(next.move);
        setLoaded(true);
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(errorText(cause));
        setLoaded(true);
      }
    });
    return () => controller.abort();
  }, [api]);
  const undo = useCallback((lineIds?: string[]) => {
    setBusy(true);
    api.memoryTopics.undoLayersMove({ requestId: createRequestId(), ...(lineIds === undefined ? {} : { lineIds }) })
      .then((next) => {
        setMove(next.move);
        setError(null);
        void live.memoryTopics.open();
      }, (cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  }, [api, live]);
  return { move, loaded, error, busy, undo };
}

function groups(items: readonly LayersMoveItemView[]): { docId: string; title: string; items: LayersMoveItemView[] }[] {
  const found: { docId: string; title: string; items: LayersMoveItemView[] }[] = [];
  for (const item of items) {
    const group = found.find((candidate) => candidate.docId === item.toDocId);
    if (group === undefined) {
      found.push({ docId: item.toDocId, title: item.toTitle, items: [item] });
    } else {
      group.items.push(item);
    }
  }
  return found;
}

export function LayersMovePage({ navigate, onBack }: { navigate: (route: Route) => void;
  onBack?: (() => void) | undefined }): ReactNode {
  const { move, loaded, error, busy, undo } = useLayersMove();
  const back = (): void => navigate({ view: 'memory', noteId: null });
  const count = move?.items.length ?? 0;
  return (
    <div className="page memory-layers">
      <PageHeader title={count === 0 ? '记忆分层' : `记忆分层 · 搬了 ${count} 条`} phoneSearch={false}
        onBack={onBack ?? back} />
      {error === null ? null : <p className="block-empty is-error" role="alert">{error}</p>}
      {!loaded ? <PageLoading /> : null}
      {loaded && count === 0 && error === null ? <p className="block-empty">现在没有搬过来的记忆。</p> : null}
      {move === null || count === 0 ? null : <>
        <div className="banner" role="note">
          <p className="banner-text layers-banner-text">搬之前的样子留着 7 天；每一条都能单独搬回去。</p>
          <button type="button" className="text-button" disabled={busy} onClick={() => undo()}>全部搬回去</button>
        </div>
        {groups(move.items).map((group) => (
          <section key={group.docId} className="block memory-block" aria-label={`搬到「${group.title}」`}>
            <div className="memory-block-head">
              <h2 className="block-title">搬到「{group.title}」</h2>
              <span className="block-meta text-mono">{group.items.length}</span>
            </div>
            <ul className="layers-moved">
              {group.items.map((item) => (
                <li key={item.lineId} className="layers-moved-row">
                  <span className="layers-moved-text">
                    <span>{item.text}</span>
                    <span className="text-meta layers-moved-from">原来在{item.fromTitle === null ? '旧的「约定」'
                      : `「${item.fromTitle}」`}</span>
                  </span>
                  <button type="button" className="chip-button layers-moved-undo" disabled={busy}
                    aria-label={`搬回去：${item.text}`} onClick={() => undo([item.lineId])}>
                    <Icon name="undo" size={14} />搬回去</button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="layers-kept text-meta">没动的 <span className="text-mono">{move.kept}</span></p>
      </>}
    </div>
  );
}
