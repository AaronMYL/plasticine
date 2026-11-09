// ✎ 改字的自动保存（第 8 批第 6 条，设计稿 Report-Edit：「字直接改、自动存」）：iframe 每交回一段，外面拼好整页交到
// 这里。一次只存一版：正在存的时候又改了，就记下最新的那份，存完接着存；版本号跟着回来的那一版走。存不上（版本过时、
// 断网）把原因交给页面，不悄悄丢掉。

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
