import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { FeedItemView } from '../../api/types.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { isOpenOp } from '../../state/action-ops.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { when } from '../notes/note-time.ts';

const COMMENT_POLL_MS = 600;

export function FeedComments({ item }: { item: FeedItemView }): ReactNode {
  const api = useApi();
  const live = useLive();
  const timeZone = useTimeZone();
  const { inlineDrafts } = useClientState();
  const key = `feed:${item.id}:comment`;
  const draftKey = `${key}:draft`;
  const drafts = useStore(inlineDrafts.store);
  const op = useOp(key);
  const locked = op !== undefined && isOpenOp(op);
  const value = locked && op.request.kind === 'feed_comment' ? op.request.body.text : drafts.get(draftKey) ?? '';
  const rows = useStore(live.feed.comments).get(item.id);
  const pending = rows?.some((row) => row.status === 'pending') ?? false;
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<() => void>(() => undefined);
  const apply = useCallback(async (signal: AbortSignal): Promise<boolean> => {
    const response = await api.feed.comments(item.id, signal);
    if (signal.aborted) { return false; }
    live.feed.applyComments(item.id, response);
    if (response.comments.every((row) => row.status !== 'pending')) { void live.feed.loadSources(); }
    return response.comments.some((row) => row.status === 'pending');
  }, [api, item.id, live]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const load = async (): Promise<void> => {
      if (running) { return; }
      running = true;
      clearTimeout(timer);
      setError(null);
      try {
        const waiting = await apply(controller.signal);
        if (waiting && !controller.signal.aborted) { timer = setTimeout(() => void load(), COMMENT_POLL_MS); }
      } catch (cause) {
        if (!controller.signal.aborted) { setError(errorText(cause)); }
      } finally { running = false; }
    };
    retry.current = () => void load();
    void load();
    const stop = live.hub.on((event) => {
      if (event.type === 'resync' || (event.type === 'feed.changed' && event.item.id === item.id)) { void load(); }
    });
    return () => { stop(); clearTimeout(timer); controller.abort(); };
  }, [apply, live, item.id, pending]);
  return <section className="feed-comments" aria-label={`「${item.title}」的评论`}>
    {rows === undefined ? <p className="text-meta">正在读评论…</p> : <ul className="feed-comment-list">
      {rows.map((row) => <li key={row.id} className={row.author === 'ai' ? 'feed-comment is-ai' : 'feed-comment'}>
        <p className="text-meta">{row.author === 'ai' ? 'Plasticine' : '你'}
          {row.migrated ? ' · 迁入评论' : ''} · {when(row.createdAt, new Date(), timeZone)}</p>
        {row.text === '' ? null : <p className="feed-comment-text">{row.text}</p>}
        {row.status !== 'pending' ? null : <p role="status" className="text-meta">Plasticine 正在回复…</p>}
        {row.error === null ? null : <p role="alert" className="is-error">{row.error}</p>}
        {row.status !== 'failed' || row.migrated ? null : <button type="button" className="text-button"
          onClick={() => void live.feedActions.retryComment(item, row.id)}>重试这次回复</button>}
      </li>)}
    </ul>}
    {error === null ? null : <p className="is-error" role="alert">{error}{' '}
      <button type="button" className="text-button" onClick={() => retry.current()}>重读评论</button></p>}
    <label className="field"><span className="field-label">评论</span>
      <textarea className="field-input" rows={2} value={value}
      readOnly={locked} maxLength={10_000} onChange={(event) => inlineDrafts.set(draftKey, event.target.value)} />
    </label>
    <div className="feed-comment-actions">
      <button type="button" className="chip-button" disabled={locked || value.trim() === ''}
        onClick={() => void live.feedActions.comment(item)}>发送评论</button>
      <button type="button" className="text-button" disabled={locked || value === ''}
        onClick={() => inlineDrafts.clear(draftKey)}>清空</button>
    </div>
  </section>;
}
