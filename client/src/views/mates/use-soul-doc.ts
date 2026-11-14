// 编辑主线、编辑队友里的 Soul（第13批设计稿 Editor）：读这一份和最近的改动，改的字先留在弹框里，「保存修改」时才存；
// 撤回夜里自己改的那一次马上生效（它本来就是一次存好的改动）。没有 owner（新建队友）时只是一段本地的字。
// 同一次存（同一版、同样的字）重试用同一个 requestId：上一回其实存上了只是回话丢了，服务端照回那一份，不报冲突。

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SoulResponse } from '../../api/shared.ts';

export interface SoulDoc {
  /** 还在读（有 owner 时）。 */
  loading: boolean;
  /** 读不到的原因。 */
  error: string | null;
  /** 存着的那一份和最近的改动；新建队友时是 null。 */
  base: SoulResponse | null;
  text: string;
  /** 改了还没存。 */
  dirty: boolean;
  setText: (text: string) => void;
  /** 存；没改过就什么都不做。回不成的原因，成了是 null。 */
  save: () => Promise<string | null>;
  /** 撤回一次改动（马上生效）。 */
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
