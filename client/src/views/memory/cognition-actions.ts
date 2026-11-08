import { Value } from 'typebox/value';
import { AgreementViewSchema } from '../../api/shared.ts';
import type { EditDrafts } from '../../state/edit-drafts.ts';
import { Store } from '../../state/store.ts';
import type { AgreementStore } from './agreement-store.ts';

export function settleCognitionDraft(
  drafts: EditDrafts, key: string, body: Record<string, unknown>, version: number,
): void {
  const draft = drafts.get(key);
  if (draft === undefined) {
    return;
  }
  if (Object.entries(draft.fields).every(([name, value]) => String(body[name] ?? '') === value)) {
    drafts.clear(key);
  } else {
    drafts.rebase(key, version);
  }
}

/** 改约定撞上别处的新版本：记下现在那一版，让编辑框给出「用新版本 / 保留我的」。保存本身由本人会话确认（state/signed-ops）。 */
export class CognitionActions {
  readonly conflicts = new Store<ReadonlyMap<string, { version: number; text: string }>>(new Map());
  private readonly agreements: AgreementStore;
  constructor(deps: { agreements: AgreementStore }) {
    this.agreements = deps.agreements;
  }

  conflict(key: string, current: unknown): void {
    if (!Value.Check(AgreementViewSchema, current)) {
      return;
    }
    this.agreements.applyAgreement(current);
    const text = `${current.text} · ${current.scope}`;
    this.conflicts.set((old) => new Map(old).set(key, { text, version: current.version }));
  }

  clearConflict(key: string): void {
    this.conflicts.set((old) => {
      const next = new Map(old);
      next.delete(key);
      return next;
    });
  }
}
