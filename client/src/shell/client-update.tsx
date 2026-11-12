import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../api/context.tsx';
import { errorText } from '../api/errors.ts';
import type { ClientVersion } from '../api/shared.ts';
import { useLive } from '../live.tsx';
import { useClientState } from '../state/context.tsx';
import { useStore } from '../state/use-store.ts';
import { hasUnsavedWork } from './unsaved-guard.ts';
import { refreshBlockers, saveNotesForRefresh } from './refresh-notes.ts';
import { documentVisibility, scheduleVersionChecks } from './version-checks.ts';
declare const __PLASTICINE_BUILD_ID__: string;
declare const __PLASTICINE_BUILT_AT__: string;
export const CLIENT_BUILD_ID =
  typeof __PLASTICINE_BUILD_ID__ === 'string' ? __PLASTICINE_BUILD_ID__ : 'development';
export const CLIENT_BUILT_AT = typeof __PLASTICINE_BUILT_AT__ === 'string' ? __PLASTICINE_BUILT_AT__ : null;
export function useClientUpdates() {
  const api = useApi();
  const live = useLive();
  const [value, setValue] = useState<ClientVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    return scheduleVersionChecks({
      check: () => setRevision((previous) => previous + 1),
      onLiveEvent: (listener) => live.hub.on((event) => listener(event.type)),
      ...documentVisibility(),
      now: () => Date.now(),
    });
  }, [live]);
  useEffect(() => {
    const controller = new AbortController();
    void api.clientUpdates.list(controller.signal).then(
      (next) => {
        if (!controller.signal.aborted) {
          setValue(next);
          setError(next.error);
        }
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorText(cause));
        }
      },
    );
    return () => controller.abort();
  }, [api, revision]);
  return { value, error };
}
export function ClientUpdateBanner(): ReactNode {
  const api = useApi();
  const state = useClientState();
  const { value } = useClientUpdates();
  useStore(state.noteDrafts.store);
  useStore(state.conversations.revision);
  useStore(state.conversationUi.store);
  useStore(state.attachments.store);
  useStore(state.inlineDrafts.store);
  useStore(state.editDrafts.store);
  useStore(state.actionOps.store);
  const unsaved = hasUnsavedWork(state);
  const [busy, setBusy] = useState(false);
  const [blockers, setBlockers] = useState<string[]>([]);
  const target = value?.current;
  const available = target !== null && target !== undefined && target.buildId !== CLIENT_BUILD_ID;
  const refresh = async () => {
    if (target === null || target === undefined || busy) {
      return;
    }
    setBusy(true);
    try {
      const reasons = await saveNotesForRefresh(api, state);
      if (reasons.length > 0) {
        setBlockers(reasons);
        return;
      }
      const fresh = await api.clientUpdates.list();
      if (fresh.current?.buildId !== target.buildId) {
        setBlockers(['可用版本已变化，请稍后重新查看']);
        return;
      }
      const remaining = refreshBlockers(state);
      if (remaining.length > 0) {
        setBlockers(remaining);
        return;
      }
      window.location.reload();
    } catch {
      setBlockers(['更新状态未能核实，请稍后再试']);
    } finally {
      setBusy(false);
    }
  };
  if (!available) {
    return null;
  }
  const compatible = target.protocol.min <= 2 && target.protocol.max >= 2;
  return (
    <div className="client-update-banner" role="status">
      <span>有新版本 · </span>
      <button type="button" className="text-button" disabled={busy || !compatible} onClick={() => void refresh()}>
        {busy ? '正在保存和核实' : unsaved ? '先保存草稿再刷新' : '刷新'}
      </button>
      {!compatible ? <span role="alert">暂时无法更新，请稍后再试。</span> : null}
      {blockers.map((item) => (
        <span className="client-update-blocker" key={item}>
          {item}
        </span>
      ))}
    </div>
  );
}
