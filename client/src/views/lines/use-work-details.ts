// 工作详情独立读取完整结果；流事件刷新当前版本，翻旧稿不会覆盖新到的交付或清空正在写的草稿。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { LineDetailsResponse } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';

export function useWorkDetails(lineId: string) {
  const api = useApi();
  const live = useLive();
  const thread = useStore(live.lines.thread(lineId));
  const [data, setData] = useState<LineDetailsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await api.lines.details(lineId, {});
      if (current !== generation.current) return;
      setData((previous) => {
        if (previous === null || previous.line.id !== next.line.id) return next;
        // 最新一页已覆盖的旧片段不能再拼回来：一次续写结束后，它们已经合成同一版了。
        const older = next.hasMore && next.nextBefore !== null
          ? previous.results.filter((row) => row.seq < next.nextBefore!) : [];
        return { ...next, results: [...next.results, ...older],
          ...(older.length === 0 ? {} : { hasMore: previous.hasMore, nextBefore: previous.nextBefore }) };
      });
      setError(null);
    } catch (cause) {
      if (current === generation.current) setError(errorText(cause));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [api, lineId]);
  useEffect(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh, thread.line?.status, thread.line?.pauseReason, thread.line?.queued,
    thread.messages.at(-1)?.seq]);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'resync') void refresh();
  }), [live, refresh]);
  const earlier = async (): Promise<void> => {
    if (data?.nextBefore == null || loadingEarlier) return;
    const before = data.nextBefore;
    const current = generation.current;
    setLoadingEarlier(true);
    try {
      const page = await api.lines.details(lineId, { before });
      if (current !== generation.current) return;
      setData((previous) => previous === null ? page : { ...previous,
        results: [...previous.results, ...page.results.filter((row) => !previous.results.some((old) =>
          old.seq === row.seq))],
        hasMore: page.hasMore, nextBefore: page.nextBefore });
      setError(null);
    } catch (cause) {
      if (current === generation.current) setError(errorText(cause));
    } finally {
      setLoadingEarlier(false);
    }
  };
  return { data, thread, error, loading, loadingEarlier, refresh, earlier };
}
