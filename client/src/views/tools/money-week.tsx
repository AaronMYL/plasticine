// 截图记账的每周汇总（《置信度与做事方式改动方案》第二批「记账直接记」，11-04 他定）：识别清楚的截图直接入账、
// 新商户标「待看」，都不再弹卡，所以账本顶上一行告诉他这周记了几笔、几笔待看。原图先留着（删除是硬线），
// 这一行里一键清掉已记账的原图：先说清后果（账目不动、原图找不回），点「删掉原图」才删。
// 这周没有截图记账、也没有留着的原图时整行不出。

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
          <p className="money-week-warn">删掉这 {summary.originals} 张已记账截图的原图？账目不动，原图删了找不回。</p>
          <button type="button" className="primary-button" disabled={working} onClick={() => void purge()}>
            删掉原图
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
