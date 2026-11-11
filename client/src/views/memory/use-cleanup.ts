// 全量整理的状态（11-11 记忆改版）：读最近一份清单和总览；正在整理时每 3 秒再读一次，整理完停。
// 开始整理、采用勾选的都在这里发，发完重读，记忆目录也跟着重读。

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ApplyCleanupResponse, LatestCleanupResponse } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';

const POLL_MS = 3_000;

export interface CleanupState {
  data: LatestCleanupResponse | null;
  error: string | null;
  reload: () => void;
  start: () => Promise<string | null>;
  apply: (itemIds: readonly string[]) => Promise<ApplyCleanupResponse | string>;
}

export function useCleanup(): CleanupState {
  const api = useApi();
  const live = useLive();
  const [data, setData] = useState<LatestCleanupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void api.memoryTopics.cleanup(controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setData(next);
      setError(null);
    }, (cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [api, revision]);
  const running = data?.cleanup?.status === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(reload, POLL_MS);
    return () => clearTimeout(timer);
  }, [running, data, reload]);
  return {
    data, error, reload,
    start: async () => {
      try {
        await api.memoryTopics.startCleanup({ requestId: createRequestId() });
        reload();
        return null;
      } catch (cause) {
        return errorText(cause);
      }
    },
    apply: async (itemIds) => {
      const cleanup = data?.cleanup;
      if (cleanup == null) return '这份清单已经不在了。';
      try {
        const result = await api.memoryTopics.applyCleanup(cleanup.id,
          { requestId: createRequestId(), version: cleanup.version, itemIds: [...itemIds] });
        reload();
        void live.memoryTopics.open();
        return result;
      } catch (cause) {
        return errorText(cause);
      }
    },
  };
}
