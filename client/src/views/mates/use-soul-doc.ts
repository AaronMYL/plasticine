import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SoulResponse } from '../../api/shared.ts';

export interface SoulDoc {
  loading: boolean;
  error: string | null;
  base: SoulResponse | null;
  text: string;
  dirty: boolean;
  setText: (text: string) => void;
  save: () => Promise<string | null>;
  undo: (revisionId: string) => Promise<string | null>;
}

const settled = (text: string): string => text.replace(/\s+$/u, '');

export function useSoulDoc(owner: string | null, initial = ''): SoulDoc {
  const api = useApi();
  const [base, setBase] = useState<SoulResponse | null>(null);
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const requests = useRef(new Map<string, string>());
  useEffect(() => {
    if (owner === null) return undefined;
    const controller = new AbortController();
    void api.souls.get(owner, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setBase(value);
      setText(value.soul.text);
      setError(null);
    }, (cause: unknown) => {
      if (!controller.signal.aborted) setError(errorText(cause));
    });
    return () => controller.abort();
  }, [api, owner]);
  const requestFor = (key: string): string => {
    const known = requests.current.get(key);
    if (known !== undefined) return known;
    const id = createRequestId();
    requests.current.set(key, id);
    return id;
  };
  const accept = (value: SoulResponse): void => {
    setBase(value);
    setText(value.soul.text);
  };
  const dirty = base !== null && settled(text) !== base.soul.text;
  const save = useCallback(async (): Promise<string | null> => {
    if (owner === null || base === null || settled(text) === base.soul.text) return null;
    const body = settled(text);
    try {
      accept(await api.souls.update(owner, { requestId: requestFor(`save:${base.soul.version}:${body}`),
        version: base.soul.version, text: body }));
      return null;
    } catch (cause) {
      return errorText(cause);
    }
  }, [api, owner, base, text]);
  const undo = useCallback(async (revisionId: string): Promise<string | null> => {
    if (owner === null) return null;
    try {
      accept(await api.souls.undo(owner, { requestId: requestFor(`undo:${revisionId}`), revisionId }));
      return null;
    } catch (cause) {
      return errorText(cause);
    }
  }, [api, owner]);
  return { loading: owner !== null && base === null && error === null, error, base, text, dirty, setText, save,
    undo };
}
