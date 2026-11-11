// 页面读数据的入口：同 key 的页面共用一份，回来直接画，事件到了后台重读（细节见 live-query.ts）。

import { useLive } from '../live.tsx';
import { queriesFor, useLiveQuery, type LiveQuery, type ReloadOn } from './live-query.ts';

export function useQuery<T>(key: string | null, fetch: (signal: AbortSignal) => Promise<T>, reloadOn: ReloadOn)
  : LiveQuery<T> {
  const live = useLive();
  return useLiveQuery(queriesFor(live.hub), key, fetch, reloadOn);
}
