import { useCallback, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SuggestionAction, TasksBoardResponse } from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';
import { useQuery } from '../../state/use-query.ts';

const RELOAD_ON: ReadonlySet<LiveEvent['type']> = new Set(['tasks.changed', 'line', 'ask.created', 'ask.answered',
  'ask.updated', 'resync', 'project.invalidated']);

export interface TasksBoardState {
  board: TasksBoardResponse | null;
  error: string | null;
  reload: () => void;
}

export function useTasksBoard(projectId: string | null): TasksBoardState {
  const api = useApi();
  const query = useQuery(`tasks.board:${projectId ?? ''}`,
    (signal) => api.tasks.board(projectId === null ? {} : { projectId }, signal), RELOAD_ON);
  return { board: query.data, error: query.error === null ? null : `任务没读到：${query.error}`, reload: query.reload };
}

export interface TaskActions {
  busy: string | null;
  failed: { id: string; text: string } | null;
  setEnabled(rowId: string, on: boolean): Promise<void>;
  remove(rowId: string): Promise<void>;
  stopTeammate(teammateId: string): Promise<void>;
  stopTimer(id: string): Promise<void>;
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
    async stopTimer(id) {
      await run(id, () => api.tasks.stopTimer({ requestId: createRequestId(), id }));
    },
    async suggestion(id, action) {
      const result = await run(id, () => api.tasks.suggestion(id, action, { requestId: createRequestId() }));
      return result?.lineId ?? null;
    },
  };
}
