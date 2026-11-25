import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { MoneyDraftSummary } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';

export function MoneyWeek(): ReactNode {
  const api = useApi();
  const live = useLive();
  const [summary, setSummary] = useState<MoneyDraftSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync' || event.type === 'money.changed' || event.type === 'money-draft.changed') {
      setRevision((value) => value + 1);
    }
  }), [live]);
  useEffect(() => {
    const controller = new AbortController();
    void api.moneyDrafts.summary(controller.signal).then((value) => {
      if (!controller.signal.aborted) {
        setSummary(value);
        setError(null);
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(errorText(cause));
      }
    });
    return () => controller.abort();
  }, [api, revision]);
  if (summary === null || (summary.recorded === 0 && summary.originals === 0)) {
    return error === null ? null : <p className="tool-sub" role="alert">{error}</p>;
  }
  const parts = [`截图记了 ${summary.recorded} 笔`,
    ...(summary.review === 0 ? [] : [`${summary.review} 笔待看`]),
    ...(summary.originals === 0 ? [] : [`原图 ${summary.originals} 张`])];
  const purge = async (): Promise<void> => {
    setWorking(true);
    try {
      await api.moneyDrafts.purgeOriginals({ requestId: createRequestId() });
      setConfirming(false);
      setError(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="money-week" role="group" aria-label="截图记账 · 这周">
      <p className="money-week-line">
        <span>{parts.join(' · ')}</span>
        {summary.originals === 0 || confirming ? null : (
          <button type="button" className="text-button text-button-quiet" onClick={() => setConfirming(true)}>
            清掉原图
          </button>
        )}
      </p>
      {!confirming ? null : (
        <div className="tool-confirm">
          <p className="money-week-warn">删除这 {summary.originals} 张已记账截图的原图？账目不动，原图删了找不回。</p>
          <button type="button" className="primary-button" disabled={working} onClick={() => void purge()}>
            删除原图
          </button>
          <button type="button" className="text-button text-button-quiet" disabled={working}
            onClick={() => setConfirming(false)}>
            先不
          </button>
        </div>
      )}
      {error === null ? null : <p className="tool-sub" role="alert">{error}</p>}
    </div>
  );
}
