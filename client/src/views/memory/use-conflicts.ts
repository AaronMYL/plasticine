// 没定的说法冲突（11-11）：记忆首页的提示条、规则里那条旁边的标记、冲突页共用一份缓存；定了一处就整份换成回来的那份。

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
