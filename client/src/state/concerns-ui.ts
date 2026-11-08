// 关切板的界面状态：哪几条点开了详情、哪一条开着哪张小表单（搁置 / 关闭 / 记登记）、新建表单开没开。放在 state/：
// 切页、换容器回来照旧（和 tasks-ui 一样）；字本身在 inline-drafts / edit-drafts 里，不在这里。
// 操作成功之后由写操作那一层调 closeForm / collapse，展开状态和表单跟着收起（审查 M2 P1：成功后状态没清）。

import { Store } from './store.ts';

export type ConcernForm = 'shelve' | 'close' | 'register';

export interface ConcernsUiState {
  openIds: ReadonlySet<string>;
  forms: ReadonlyMap<string, ConcernForm>;
  creating: boolean;
}

export class ConcernsUi {
  readonly store = new Store<ConcernsUiState>({ openIds: new Set(), forms: new Map(), creating: false });

  isOpen(id: string): boolean {
    return this.store.get().openIds.has(id);
  }

  toggle(id: string): void {
    this.setOpen(id, !this.isOpen(id));
  }

  /** 关切条上点「关切 ›」：到关切板时这一条已经点开。 */
  expand(id: string): void {
    this.setOpen(id, true);
  }

  collapse(id: string): void {
    this.setOpen(id, false);
    this.closeForm(id);
  }

  openForm(id: string, form: ConcernForm): void {
    this.store.set((state) => ({ ...state, forms: new Map(state.forms).set(id, form) }));
  }

  closeForm(id: string): void {
    this.store.set((state) => {
      if (!state.forms.has(id)) {
        return state;
      }
      const forms = new Map(state.forms);
      forms.delete(id);
      return { ...state, forms };
    });
  }

  setCreating(creating: boolean): void {
    this.store.set((state) => (state.creating === creating ? state : { ...state, creating }));
  }

  private setOpen(id: string, open: boolean): void {
    this.store.set((state) => {
      if (state.openIds.has(id) === open) {
        return state;
      }
      const openIds = new Set(state.openIds);
      if (open) {
        openIds.add(id);
      } else {
        openIds.delete(id);
      }
      return { ...state, openIds };
    });
  }
}
