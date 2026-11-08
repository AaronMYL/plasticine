// 对方只说「再改改」时先补充修改意见；继续原执行线和本人接手是两个不同动作。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { AskView, NetworkTaskView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

export function WorkRevision({ task, name, onAnswered }:
  { task: NetworkTaskView; name: string; onAnswered: () => void }): ReactNode {
  const api = useApi();
  const live = useLive();
  const { inlineDrafts } = useClientState();
  const key = `work:${task.id}:revision`;
  const text = useStore(inlineDrafts.store).get(key) ?? '';
  const asks = useStore(live.asks.store);
  const [fetched, setFetched] = useState<AskView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const id = task.revisionAskId;
  const ask = asks.open.find((item) => item.id === id) ?? fetched;
  const work = id == null ? undefined : asks.work.get(id);
  useEffect(() => {
    if (id == null) return;
    const controller = new AbortController();
    api.asks.get(id, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setFetched(next);
      setError(null);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    return () => controller.abort();
  }, [api, id, round]);
  const valid = ask !== null && ask.status === 'open' && ask.networkTaskId === task.id
    && ask.options.some((option) => option.id === 'by_ai') && ask.options.some((option) => option.id === 'by_person');
  const answer = (optionId: 'by_ai' | 'by_person'): void => {
    if (!valid || ask === null) return;
    const sent = text.trim();
    void live.asks.answer(ask, { optionId, ...(sent === '' ? {} : { text: sent }) }).then(() => {
      if (!live.asks.store.get().work.get(ask.id)?.error) {
        inlineDrafts.clearIfSent(key, sent);
        onAnswered();
      }
    });
  };
  return <section className="work-revision" aria-label="补充修改意见">
    <h3>{name}退回了这份交付</h3>
    <p>{task.verdict?.note.trim() || '还没有修改意见。接下来要改哪里？'}</p>
    <textarea className="field-input" aria-label="修改意见" placeholder="补充修改意见" rows={3} value={text}
      onChange={(event) => inlineDrafts.set(key, event.target.value)} disabled={work?.busy} />
    <div className="work-revision-actions">
      <button type="button" className="primary-button" disabled={!valid || work?.busy || text.trim() === ''}
        onClick={() => answer('by_ai')}>让 Plasticine 继续</button>
      <button type="button" className="secondary-button" disabled={!valid || work?.busy}
        onClick={() => answer('by_person')}>我来处理</button>
    </div>
    {error === null && work?.error == null ? null : <p className="work-error" role="alert">{work?.error ?? error}
      {error === null ? null : <button type="button" className="text-button"
        onClick={() => setRound((value) => value + 1)}>重试</button>}</p>}
    {id == null ? <p className="work-error" role="alert">修改卡暂时读不到。
      <button type="button" className="text-button" onClick={onAnswered}>刷新</button></p> : null}
  </section>;
}
