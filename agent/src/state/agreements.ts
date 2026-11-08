// 约定：生效和撤由用户确认（《从零方案》第 5 节「约定」），所以 state 与 effectiveAt 是用户确认字段，只能经
// `confirm` 写入。普通写入（脑的提议、前提变了）只能把约定置为待议 under_review，或改提议字段 proposedDiff。

import { Type } from 'typebox';
import {
  AgreementConfirmedSchema,
  AgreementInputSchema,
  AgreementPatchSchema,
  AgreementSchema,
  type Agreement,
  type AgreementInput,
  type AgreementPatch,
  type Change,
  type CreateOptions,
  type Page,
  type AgreementConfirmed,
  type DeviceConfirmation,
  TermDefinitionSchema,
} from '../../shared/state.ts';
import { requireConfirmation } from './confirmed-fields.ts';
import { StateError, versionConflict } from './errors.ts';
import { checked, CONFIRMATION_META_COLUMNS, OBJECT_META_COLUMNS, type ColumnMap } from './codec.ts';
import { ObjectStore, type StoreContext, type StoreSpec } from './object-store.ts';

const COLUMNS: ColumnMap = {
  ...OBJECT_META_COLUMNS,
  ...CONFIRMATION_META_COLUMNS,
  kind: 'text',
  title: 'text',
  text: 'text',
  scope: 'text',
  userQuote: 'text',
  quotedAt: 'text',
  perUseConfirmation: 'boolean',
  premises: 'json',
  state: 'text',
  proposedDiff: 'text',
  effectiveAt: 'text',
  termTier: 'text',
  proposedTerm: 'json',
};

// Every agreement starts 待议: only the user's device confirmation makes it take effect (第 3 节第 1 条).
const UNDER_REVIEW = 'under_review';
const DEFAULTS = {
  perUseConfirmation: false,
  premises: [],
  state: UNDER_REVIEW,
};

type Spec = StoreSpec<
  typeof AgreementSchema,
  typeof AgreementInputSchema,
  typeof AgreementPatchSchema,
  typeof AgreementConfirmedSchema
>;

const SPEC: Spec = {
  table: 'agreements',
  searchSource: 'agreement',
  objectType: 'agreement',
  schema: AgreementSchema,
  input: AgreementInputSchema,
  patch: AgreementPatchSchema,
  confirmedInput: AgreementConfirmedSchema,
  columns: COLUMNS,
  defaults: DEFAULTS,
  confirmed: [{ field: 'state', freeValues: [UNDER_REVIEW] }, { field: 'effectiveAt' }],
  migrationImport: true,
};

// Changing any of these changes what an agreement means. An agreement in effect does not keep its device
// confirmation over a new meaning: the same write moves it back to 待议 until the user confirms again.
const MEANING_FIELDS = ['kind', 'text', 'scope', 'perUseConfirmation', 'premises', 'termTier'] as const;

function changesMeaning(current: Agreement, patch: AgreementPatch): boolean {
  if (current.kind === 'term' && patch.title !== undefined && patch.title !== current.title) {
    return true;
  }
  return MEANING_FIELDS.some((field) => {
    const next = patch[field];
    return next !== undefined && JSON.stringify(next) !== JSON.stringify(current[field]);
  });
}

export type AgreementFilter = {
  state?: Agreement['state'];
  kind?: Agreement['kind'];
};

export function createAgreementStore(context: StoreContext) {
  const store = new ObjectStore(context, SPEC);
  return {
    // No fourth argument: confirmed fields carried over from the old system only come in through importEffective.
    create: (input: AgreementInput, change?: Change, options?: CreateOptions): Agreement =>
      store.create(input, change, options),
    get: store.get.bind(store),
    require: store.require.bind(store),
    update: (id: string, expectedVersion: number, patch: AgreementPatch, change?: Change): Agreement => {
      // Read and write share the version check, so the state read here is the one the update replaces.
      const current = store.require(id);
      const inEffect = current.version === expectedVersion && current.state === 'active';
      const reopen = inEffect && changesMeaning(current, patch);
      if (reopen && current.kind === 'term') {
        const proposedTerm = checked(TermDefinitionSchema, {
          title: patch.title ?? current.title ?? '', text: patch.text ?? current.text,
          scope: patch.scope ?? current.scope, termTier: patch.termTier ?? current.termTier,
        }, 'invalid_input', '词语提议需要完整档位与定义');
        return store.update(id, expectedVersion, { proposedTerm }, change);
      }
      return store.update(id, expectedVersion, reopen ? { ...patch, state: UNDER_REVIEW } : patch, change);
    },
    confirm(id: string, expectedVersion: number, fields: AgreementConfirmed,
      confirmation: DeviceConfirmation, reason: string): Agreement {
      requireConfirmation(confirmation);
      return context.db.transaction(() => {
        let current = store.require(id);
        if (current.version !== expectedVersion) {
          throw versionConflict('agreements', id, expectedVersion, current.version);
        }
        if (fields.state === 'active' && current.proposedTerm !== null) {
          const change = { actor: 'user' as const, actorRef: confirmation.deviceId, reason };
          current = store.update(id, expectedVersion, {
            ...current.proposedTerm, proposedTerm: null, proposedDiff: null,
          }, change);
        }
        return store.confirm(id, current.version, fields, confirmation, reason);
      });
    },
    history: store.history.bind(store),
    list: (filter: AgreementFilter = {}, page: Page = {}): Agreement[] => store.list(filter, page),
    /** For the 约定 column of the memory view: newest first. */
    newestFirst(filter: AgreementFilter, page: Page): Agreement[] {
      const clauses = ['1 = 1'];
      const params: Record<string, string> = {};
      if (filter.state !== undefined) {
        clauses.push('state = $state');
        params['state'] = filter.state;
      }
      if (filter.kind !== undefined) {
        clauses.push('kind = $kind');
        params['kind'] = filter.kind;
      }
      return store.select(clauses.join(' AND '), params, page, 'created_at DESC, id DESC');
    },
    /**
     * Migration only (decision 82): an old guide section comes over already in effect, marked migratedDefault so
     * the UI shows it as 「待你确认」 until the user confirms or revokes it on a device.
     */
    importEffective: (input: AgreementInput, effectiveAt: string, legacyPayload: unknown, reason: string) => {
      const change = { actor: 'migration' as const, reason };
      const imported = { state: 'active' as const, effectiveAt };
      return store.create(input, change, { migratedDefault: true, legacyPayload }, imported);
    },
  };
}

export type AgreementStore = ReturnType<typeof createAgreementStore>;
