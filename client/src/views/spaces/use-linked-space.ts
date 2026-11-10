import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { SpaceView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';

/** 所有嵌入入口读取同一份空间；失效事件只有身份，正文总是重新读取最新版本。 */
export function useLinkedSpace(spaceId: string | null) {
  const api = useApi();
  const live = useLive();
  const [value, setValue] = useState<SpaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((current) => current + 1), []);
  useEffect(() => {
    if (spaceId === null) return undefined;
    const controller = new AbortController();
    setError(null);
    void api.spaces.get(spaceId, controller.signal).then((space) => {
      if (!controller.signal.aborted) setValue(space);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) { setValue(null); setError(errorText(cause)); }
    });
    return () => controller.abort();
  }, [api, spaceId, revision]);
  useEffect(() => {
    if (spaceId === null) return undefined;
    const stop = live.hub.on((event) => {
      if (event.type === 'resync' || event.type === 'space.changed' && event.spaceId === spaceId) reload();
    });
    window.addEventListener('focus', reload);
    return () => { stop(); window.removeEventListener('focus', reload); };
  }, [live.hub, spaceId, reload]);
  return { value: value?.id === spaceId ? value : null, error, reload };
}
