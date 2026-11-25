import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SpaceView } from '../../api/shared.ts';

export interface SpaceSaver {
  save: (html: string) => void;
  saving: boolean;
  error: string | null;
}

export function useSpaceSaver(space: SpaceView | null, onSaved: (next: SpaceView) => void): SpaceSaver {
  const api = useApi();
  const version = useRef(space?.version ?? 1);
  const pending = useRef<string | null>(null);
  const running = useRef(false);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = space?.id ?? null;
  useEffect(() => {
    if (space !== null && space.version > version.current) version.current = space.version;
  }, [space]);
  const run = useCallback(async (): Promise<void> => {
    if (id === null || running.current) return;
    running.current = true;
    setSaving(true);
    try {
      while (pending.current !== null) {
        const html = pending.current;
        pending.current = null;
        const next = await api.spaces.save(id, { requestId: createRequestId(), version: version.current, html });
        version.current = next.version;
        setError(null);
        saved.current(next);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      running.current = false;
      setSaving(false);
    }
  }, [api, id]);
  const save = useCallback((html: string): void => {
    pending.current = html;
    void run();
  }, [run]);
  return { save, saving, error };
}
