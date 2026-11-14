import { useEffect, useRef, useState } from 'react';
import { ApiError, errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { BatchItem, BatchRequest, BatchResponse, EmptyTrashRequest } from '../../api/shared.ts';

export interface BulkItem extends BatchItem { title: string; fileCount?: number }
export interface BulkCommand { requestId: string; action: BatchRequest['action']; items: BatchItem[];
  destination?: string }
export interface BulkOptions {
  items: readonly BulkItem[];
  run: (input: BulkCommand) => Promise<BatchResponse>;
  empty?: ((input: EmptyTrashRequest) => Promise<BatchResponse>) | undefined;
  onChanged: () => void;
  scope?: string;
}
export const bulkKey = (item: BatchItem): string => `${item.kind}:${item.id}`;
type Attempt = { command: BulkCommand; empty?: EmptyTrashRequest };

export function useBulkSelection({ items, run, empty, onChanged, scope }: BulkOptions) {
  const [active, setActive] = useState(false);
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [report, setReport] = useState<BatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const selected = items.filter((item) => keys.has(bulkKey(item)));
  useEffect(() => {
    const present = new Set(items.map(bulkKey));
    setKeys((current) => [...current].every((key) => present.has(key)) ? current
      : new Set([...current].filter((key) => present.has(key))));
  }, [items]);
  useEffect(() => { setKeys(new Set()); setActive(false); anchor.current = null; }, [scope]);
  /** 跑一次批量：成了返回结果（逐项成没成），没跑或出错是 null（原因在 error 里）。 */
  const execute = async (next: Attempt): Promise<BatchResponse | null> => {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setError(null);
    setCanRetry(false);
    attempt.current = next;
    try {
      const response = next.empty === undefined ? await run(next.command) : await empty!(next.empty);
      setReport(response);
      setUncertain(false);
      const failed = response.results.filter((result) => !result.ok);
      setKeys(new Set(failed.map(bulkKey)));
      setCanRetry(failed.length > 0);
      attempt.current = { command: { ...next.command, items: failed.map(({ kind, id }) => ({ kind, id })) } };
      onChanged();
      return response;
    } catch (cause) {
      const conflict = cause instanceof ApiError && cause.status === 409;
      setReport(null);
      setError(errorText(cause));
      setUncertain(cause instanceof ApiError && cause.kind === 'uncertain');
      setCanRetry(!conflict);
      if (conflict) onChanged();
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return {
    active, selected, busy, report, error, uncertain, canRetry,
    checked: (item: BatchItem): boolean => keys.has(bulkKey(item)),
    start: (): void => setActive(true),
    finish: (): void => { if (!running.current) { setActive(false); setKeys(new Set()); anchor.current = null; } },
    all: (): void => setKeys(selected.length === items.length ? new Set() : new Set(items.map(bulkKey))),
    toggle: (item: BulkItem, shift = false): void => {
      if (running.current) return;
      const key = bulkKey(item);
      const from = items.findIndex((row) => bulkKey(row) === anchor.current);
      const to = items.findIndex((row) => bulkKey(row) === key);
      const range = shift && from >= 0 ? items.slice(Math.min(from, to), Math.max(from, to) + 1) : [item];
      setKeys((current) => {
        const next = new Set(current);
        for (const row of range) {
          if (current.has(key)) next.delete(bulkKey(row)); else next.add(bulkKey(row));
        }
        return next;
      });
      anchor.current = key;
    },
    perform: (action: BatchRequest['action'], destination?: string,
      targets = selected): Promise<BatchResponse | null> => {
      if (targets.length === 0) return Promise.resolve(null);
      return execute({ command: { requestId: createRequestId(), action,
        items: targets.map(({ kind, id }) => ({ kind, id })),
        ...(destination === undefined ? {} : { destination }) } });
    },
    empty: (expectCount = items.length): Promise<BatchResponse | null> => {
      if (empty === undefined || expectCount === 0) return Promise.resolve(null);
      const requestId = createRequestId();
      return execute({ command: { requestId, action: 'purge', items: items.map(({ kind, id }) => ({ kind, id })) },
        empty: { requestId, expectCount } });
    },
    retry: (): Promise<BatchResponse | null> => {
      const last = attempt.current;
      if (!canRetry || last === null) return Promise.resolve(null);
      const requestId = uncertain ? last.command.requestId : createRequestId();
      return execute({ command: { ...last.command, requestId },
        ...(last.empty === undefined ? {} : { empty: { ...last.empty, requestId } }) });
    },
  };
}
export type BulkSelection = ReturnType<typeof useBulkSelection>;
