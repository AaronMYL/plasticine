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
