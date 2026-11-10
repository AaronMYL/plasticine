import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { createRequestId } from '../../api/request-id.ts';
import { errorText } from '../../api/errors.ts';
import type { ChangeSoulRequest, SoulView } from '../../api/shared.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

type SoulInput = ChangeSoulRequest extends infer T ? T extends ChangeSoulRequest ? Omit<T, 'requestId'> : never : never;
const KEY = 'soul:change';

export function useSoul() {
  const api = useApi();
  const { actionOps } = useClientState();
  const operations = useStore(actionOps.store);
  const operation = operations.find((item) => item.key === KEY);
  const [value, setValue] = useState<SoulView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void api.soul.get(controller.signal).then((next) => {
      if (!controller.signal.aborted) { setValue(next); setError(null); }
    }, (cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [api, revision]);
  const send = useCallback(async (request: ChangeSoulRequest): Promise<boolean> => {
    try {
      setValue(await api.soul.change(request));
      actionOps.succeed(KEY);
      return true;
    } catch (cause) {
      actionOps.fail(KEY, cause);
      return false;
    }
  }, [api, actionOps]);
  const change = useCallback(async (input: SoulInput): Promise<boolean> => {
    const request = actionOps.begin(KEY, '修改 Soul', '主线的 Soul', (requestId) => ({ kind: 'soul_change',
      body: { ...input, requestId } }), createRequestId);
    return request.kind === 'soul_change' ? send(request.body) : false;
  }, [actionOps, send]);
  const retry = useCallback(async (): Promise<boolean> => {
    const request = actionOps.retry(KEY);
    return request?.kind === 'soul_change' ? send(request.body) : false;
  }, [actionOps, send]);
  return { value, error, operation, change, retry, reload: () => setRevision((previous) => previous + 1) };
}
