import { useLive } from '../live.tsx';
import { queriesFor, useLiveQuery, type LiveQuery, type ReloadOn } from './live-query.ts';

export function useQuery<T>(key: string | null, fetch: (signal: AbortSignal) => Promise<T>, reloadOn: ReloadOn)
  : LiveQuery<T> {
  const live = useLive();
  return useLiveQuery(queriesFor(live.hub), key, fetch, reloadOn);
}
