// 任务清单的界面状态：对话栏里的折叠段开没开、「在做」超过 7 条时展没展开、哪几条任务条点开了。
// 放在 state/：清单整页和对话栏折叠段是一份数据两个入口，切页、换容器回来照旧（《UI 方案》第 5 节）。

import { Store } from './store.ts';

export interface TasksUiState {
  foldOpen: boolean;
  doingExpanded: boolean;
  openTaskIds: ReadonlySet<string>;
}

export class TasksUi {
  readonly store = new Store<TasksUiState>({ foldOpen: false, doingExpanded: false, openTaskIds: new Set() });

  setFoldOpen(open: boolean): void {
    this.store.set((state) => ({ ...state, foldOpen: open }));
  }

  setDoingExpanded(expanded: boolean): void {
    this.store.set((state) => ({ ...state, doingExpanded: expanded }));
  }

  toggleTask(taskId: string): boolean {
    const open = !this.store.get().openTaskIds.has(taskId);
    this.store.set((state) => {
      const openTaskIds = new Set(state.openTaskIds);
      if (open) {
        openTaskIds.add(taskId);
      } else {
        openTaskIds.delete(taskId);
      }
      return { ...state, openTaskIds };
    });
    return open;
  }
}
