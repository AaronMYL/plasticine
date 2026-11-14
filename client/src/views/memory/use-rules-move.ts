// 规则搬家的数据（第13批）：还在「规则」里的每一条和建议去处；搬的时候同一批（同样的勾、同样的去处）重试用同一个
// requestId，上一回其实搬了只是回话丢了，服务端照回那一次的结果。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ApplyRulesMoveRequest, ApplyRulesMoveResponse, RulesMoveResponse } from '../../api/shared.ts';

export interface RulesMove {
  data: RulesMoveResponse | null;
  error: string | null;
  reload: () => void;
  /** 照勾的搬；回结果或没搬成的原因。 */
  apply: (moves: ApplyRulesMoveRequest['moves']) => Promise<ApplyRulesMoveResponse | string>;
}

export function useRulesMove(): RulesMove {
  const api = useApi();
  const [data, setData] = useState<RulesMoveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const requests = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController();
    void api.souls.rulesMove(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setData(value);
      setError(null);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    return () => controller.abort();
  }, [api, round]);
  const reload = useCallback(() => setRound((value) => value + 1), []);
  const apply = useCallback(async (moves: ApplyRulesMoveRequest['moves']) => {
    const key = JSON.stringify(moves);
    const requestId = requests.current.get(key) ?? createRequestId();
    requests.current.set(key, requestId);
    try {
      const result = await api.souls.applyRulesMove({ requestId, moves });
      setRound((value) => value + 1);
      return result;
    } catch (cause) {
      return errorText(cause);
    }
  }, [api]);
  return { data, error, reload, apply };
}
