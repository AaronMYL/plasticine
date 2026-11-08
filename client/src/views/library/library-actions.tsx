// 资料库里的改名和删除（2026-11-08）：空间改名走 PUT /v2/spaces/:id（先读到 version 和正文，只换标题），删除走
// DELETE /v2/spaces/:id；书改名 PATCH、删除 DELETE。删除前一律先问（ConfirmDialog），删了进「最近删除」能还原。
// 做完通知资料库各处重读（library-signal.ts）。

import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { libraryChanged } from './library-signal.ts';

/** 删除前那一行后果（他定的原话）。 */
export const DELETE_CONSEQUENCE = '会移到「最近删除」，在那里可以还原。';

export interface SpaceActions {
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function useSpaceActions(): SpaceActions {
  const api = useApi();
  return {
    rename: async (id, title) => {
      const space = await api.spaces.get(id);
      await api.spaces.save(id, { requestId: createRequestId(), version: space.version, title, doc: space.doc });
      libraryChanged();
    },
    remove: async (id) => {
      const space = await api.spaces.get(id);
      await api.spaces.remove(id, { requestId: createRequestId(), version: space.version });
      libraryChanged();
    },
  };
}

interface Pending {
  name: string;
  run: () => Promise<void>;
  after?: (() => void) | undefined;
}

/** 「删除「名字」？」：ask 开框，确认后跑 run，成了再跑 after（比如离开这一页）；失败原因留在框里。 */
export function useDeleteConfirm(): { ask: (name: string, run: () => Promise<void>, after?: () => void) => void;
  dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = (): void => {
    setPending(null);
    setBusy(false);
    setError(null);
  };
  const confirm = (): void => {
    if (pending === null) return;
    setBusy(true);
    setError(null);
    pending.run().then(() => {
      const after = pending.after;
      close();
      after?.();
    }, (cause: unknown) => {
      setBusy(false);
      setError(errorText(cause));
    });
  };
  const dialog = pending === null ? null : (
    <ConfirmDialog title={`删除「${pending.name}」？`} body={DELETE_CONSEQUENCE} confirmLabel="删除" busy={busy}
      error={error} onConfirm={confirm} onCancel={close} />
  );
  return { ask: (name, run, after) => setPending({ name, run, after }), dialog };
}
