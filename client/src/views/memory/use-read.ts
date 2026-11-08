import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../api/errors.ts';
import { useLive } from '../../live.tsx';

// 读一样东西：resync 来了重读，给出值、错误和重读。
export function useRead<T>(read: (signal: AbortSignal) => Promise<T>) {
  const live = useLive();
  const [revision, setRevision] = useState(0);
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      live.hub.on((event) => {
        if (event.type === 'resync') {
          setRevision((previous) => previous + 1);
        }
      }),
    [live],
  );
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setValue(result);
          setError(null);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      },
    );
    return () => controller.abort();
  }, [read, revision]);
  const reload = useCallback(() => setRevision((previous) => previous + 1), []);
  return { value, error, reload };
}
