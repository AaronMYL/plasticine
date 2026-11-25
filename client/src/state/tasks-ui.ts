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
