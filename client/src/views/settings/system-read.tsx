// 设置 · 系统各块共用：读一样东西（可轮询），读失败就地说原因并给「重新读取」。

import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../../api/errors.ts';

export function useRead<T>(read: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[], pollMs = 0)
  : { value: T | null; error: string | null; reload: () => void } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = (): void => {
      read(controller.signal).then((next) => {
        if (!controller.signal.aborted) {
          setValue(next);
          setError(null);
        }
      }, (cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      });
    };
    load();
    const timer = pollMs > 0 ? setInterval(load, pollMs) : null;
    return () => {
      controller.abort();
      if (timer !== null) clearInterval(timer);
    };
    // read 每次渲染都是新函数；读什么由 deps 决定。
  }, [...deps, round]);
  return { value, error, reload: () => setRound((old) => old + 1) };
}

export function Failure({ error, onReload }: { error: string; onReload: () => void }): ReactNode {
  return (
    <p className="block-empty is-error" role="alert">
      {error}{' '}<button type="button" className="text-button" onClick={onReload}>重新读取</button>
    </p>
  );
}
