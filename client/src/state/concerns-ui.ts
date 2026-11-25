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
