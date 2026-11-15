// 资料库里的改名和删除（2026-11-08）：空间改名走 PUT /v2/spaces/:id（先读到 version，只给标题），删除走
// DELETE /v2/spaces/:id；书改名 PATCH、删除 DELETE。删了进「最近删除」能还原：11-14 起不再先问，删完给撤销。
// 做完通知资料库各处重读（library-signal.ts）。

import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { showResultToast, showToast } from '../../primitives/toast/index.tsx';
import { libraryChanged } from './library-signal.ts';

export interface SpaceActions {
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
}

export function useSpaceActions(): SpaceActions {
  const api = useApi();
  return {
    rename: async (id, title) => {
      const space = await api.spaces.get(id);
      await api.spaces.save(id, { requestId: createRequestId(), version: space.version, title });
      libraryChanged();
    },
    remove: async (id) => {
      const space = await api.spaces.get(id);
      await api.spaces.remove(id, { requestId: createRequestId(), version: space.version });
      libraryChanged();
    },
    restore: async (id) => {
      await api.spaces.restore(id, { requestId: createRequestId() });
      libraryChanged();
    },
  };
}

/**
 * 删了进「最近删除」、找得回的（11-14 Aaron 弹框选「找得回的不确认，给撤销」）：不再先问，直接删；底部那一种提示条
 * 「已把「名字」移到最近删除 · 撤销」，点撤销就还原。删成了再跑 after（比如离开这一页）；没删成、没还原成也用提示条说。
 */
export function useUndoableDelete(): { remove: (name: string, run: () => Promise<void>, restore: () => Promise<void>,
  after?: () => void) => void } {
  return {
    remove: (name, run, restore, after) => {
      run().then(() => {
        after?.();
        showToast({ text: `已把「${name}」移到最近删除`, action: { label: '撤销', icon: 'undo', run: () => {
          restore().then(() => {
            libraryChanged();
            showResultToast(`「${name}」放回来了`, false);
          }, (cause: unknown) => showResultToast(errorText(cause), true));
        } } });
      }, (cause: unknown) => showResultToast(errorText(cause), true));
    },
  };
}
