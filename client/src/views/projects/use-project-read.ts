import { useCallback, useEffect, useState } from 'react';
import { errorText } from '../../api/errors.ts';
import { useLive } from '../../live.tsx';

export interface ProjectRead<T> {
  value: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useProjectRead<T>(read: (signal: AbortSignal) => Promise<T>, projectId?: string): ProjectRead<T> {
  const live = useLive();
  const [revision, setRevision] = useState(0);
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(
    () =>
      live.hub.on((event) => {
        if (event.type === 'resync' || event.type === 'project.invalidated'
          && (projectId === undefined || event.projectId === projectId)) {
          setRevision((previous) => previous + 1);
        }
      }),
    [live, projectId],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void read(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) {
          setValue(result);
          setError(null);
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [read, revision]);
  const reload = useCallback(() => setRevision((previous) => previous + 1), []);
  return { value, error, loading, reload };
}
