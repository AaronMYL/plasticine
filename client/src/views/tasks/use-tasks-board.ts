// 任务栏目的数据（《优化清单》第 3、4、5 条）：第二栏和主区读同一份（GET /v2/tasks/board）。打开时读一次；定时、建议、
// 线、卡变了（事件）隔一小会儿再读，一串连着来的只读一次。写操作（开关、删、叫停、建议三个动作）各带一个 requestId，
// 成功后重读；没成的那一行就地写一句原因。

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SuggestionAction, TasksBoardResponse } from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';
import { useLive } from '../../live.tsx';

/** 事件来了等这么久再读（同首页的 400ms）：一串连着来的只读一次。 */
const RELOAD_DELAY_MS = 400;
const RELOAD_ON: ReadonlySet<LiveEvent['type']> = new Set(['tasks.changed', 'line', 'ask.created', 'ask.answered',
  'ask.updated', 'resync', 'project.invalidated']);

export interface TasksBoardState {
  board: TasksBoardResponse | null;
  error: string | null;
  reload: () => void;
}

export function useTasksBoard(projectId: string | null): TasksBoardState {
  const api = useApi();
  const live = useLive();
  const [board, setBoard] = useState<TasksBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const reload = useCallback(() => setRound((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    api.tasks.board(projectId === null ? {} : { projectId }, controller.signal).then((next) => {
      if (!controller.signal.aborted) {
        setBoard(next);
        setError(null);
      }
    }, (cause: unknown) => {
      if (!controller.signal.aborted) {
        setError(`任务没读到：${errorText(cause)}`);
      }
    });
    return () => controller.abort();
  }, [api, projectId, round]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = live.hub.on((event) => {
      if (!RELOAD_ON.has(event.type)) {
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => setRound((value) => value + 1), RELOAD_DELAY_MS);
    });
    return () => {
      stop();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [live.hub]);
  return { board, error, reload };
}

export interface TaskActions {
  /** 正在提交的那一项（行 id、队友 id、建议 id）。 */
  busy: string | null;
  /** 没成的那一项和一句原因。 */
  failed: { id: string; text: string } | null;
  setEnabled(rowId: string, on: boolean): Promise<void>;
  remove(rowId: string): Promise<void>;
  stopTeammate(teammateId: string): Promise<void>;
  suggestion(id: string, action: SuggestionAction): Promise<string | null>;
}

export function useTaskActions(reload: () => void): TaskActions {
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);
  const run = useCallback(async <T,>(id: string, work: () => Promise<T>): Promise<T | null> => {
    setBusy(id);
    setFailed(null);
    try {
      const result = await work();
      reload();
      return result;
    } catch (cause) {
      setFailed({ id, text: errorText(cause) });
      return null;
    } finally {
      setBusy(null);
    }
  }, [reload]);
  return {
    busy,
    failed,
    async setEnabled(rowId, on) {
      await run(rowId, () => api.tasks.setTimedEnabled({ requestId: createRequestId(), rowId, on }));
    },
    async remove(rowId) {
      await run(rowId, () => api.tasks.removeTimed({ requestId: createRequestId(), rowId }));
    },
    async stopTeammate(teammateId) {
      await run(teammateId, () => api.tasks.stopTeammate({ requestId: createRequestId(), teammateId }));
    },
    async suggestion(id, action) {
      const result = await run(id, () => api.tasks.suggestion(id, action, { requestId: createRequestId() }));
      return result?.lineId ?? null;
    },
  };
}
