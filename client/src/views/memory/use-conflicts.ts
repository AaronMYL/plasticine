import { useApi } from '../../api/context.tsx';
import type { ConflictListResponse } from '../../api/shared.ts';
import type { LiveEvent } from '../../api/types.ts';
import { useQuery } from '../../state/use-query.ts';
import type { LiveQuery } from '../../state/live-query.ts';

const NO_EVENTS: ReadonlySet<LiveEvent['type']> = new Set();
export const CONFLICTS_KEY = 'memory.conflicts';

export function useConflicts(): LiveQuery<ConflictListResponse> {
  const api = useApi();
  return useQuery(CONFLICTS_KEY, (signal) => api.soul.conflicts(signal), NO_EVENTS);
}
