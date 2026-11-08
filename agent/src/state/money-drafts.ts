import { Type } from 'typebox';
import {
  MoneyDraftSchema,
  PaymentCandidateSchema,
  EMPTY_PAYMENT_CANDIDATE,
  type MoneyDraft,
  type PaymentCandidate,
  type PaymentFields,
} from '../../shared/money-drafts.ts';
import type { DeviceConfirmation } from '../../shared/state.ts';
import { checked, readRow } from './codec.ts';
import { requireConfirmation } from './confirmed-fields.ts';
import { StateError } from './errors.ts';
import type { StoreContext } from './object-store.ts';
import type { Row } from './db.ts';

const Wrapped = Type.Object({ metadata: MoneyDraftSchema });
export function createMoneyDraftStore(context: StoreContext) {
  const { db } = context;
  const read = (row: Row) => readRow(Wrapped, { metadata: 'json' }, row, '记账草案').metadata;
  const get = (id: string): MoneyDraft | null => {
    const row = db.get('SELECT metadata FROM money_drafts WHERE id = $id', { id });
    return row === undefined ? null : read(row);
  };
  const require = (id: string): MoneyDraft => {
    const row = get(id);
    if (row === null) {
      throw new StateError('not_found', '没有找到记账草案。');
    }
    return row;
  };
  const writable = (id: string, version: number) => {
    const row = require(id);
    if (row.version !== version) {
      throw new StateError('version_conflict', '草案在别处改过，请先读最新版。', { currentVersion: row.version });
    }
    if (row.status === 'confirmed' || row.status === 'rejected') {
      throw new StateError('invalid_input', '这份草案已经处理完。');
    }
    return row;
  };
  const save = (row: MoneyDraft) => {
    const next = checked(
      MoneyDraftSchema,
      { ...row, version: row.version + 1, updatedAt: context.now() },
      'invalid_input',
      '记账草案',
    );
    db.run('UPDATE money_drafts SET metadata = $metadata, entry_id = $entryId WHERE id = $id', {
      metadata: JSON.stringify(next),
      id: next.id,
      entryId: next.entryId,
    });
    return next;
  };
  return {
    get,
    require,
    byAttachment(attachmentId: string): MoneyDraft | null {
      const row = db.get('SELECT metadata FROM money_drafts WHERE attachment_id = $attachmentId', { attachmentId });
      return row === undefined ? null : read(row);
    },
    create(input: { requestId: string; attachmentId: string; messageId: string | null; sha256: string }): MoneyDraft {
      const row = db.get('SELECT metadata FROM money_drafts WHERE request_id = $requestId', {
        requestId: input.requestId,
      });
      if (row !== undefined) {
        const previous = read(row);
        if (previous.attachmentId !== input.attachmentId) {
          throw new StateError('duplicate', '识别标识已用于另一张图片。');
        }
        return previous;
      }
      const duplicate = db.get(
        'SELECT entry_id FROM money_drafts WHERE sha256 = $sha AND entry_id IS NOT NULL LIMIT 1',
        { sha: input.sha256 },
      );
      const now = context.now();
      const draft: MoneyDraft = {
        id: context.newId(),
        version: 1,
        requestId: input.requestId,
        attachmentId: input.attachmentId,
        messageId: input.messageId,
        candidate: { ...EMPTY_PAYMENT_CANDIDATE },
        status: 'reading',
        askId: null,
        runId: null,
        entryId: null,
        error: null,
        confirmedByDeviceId: null,
        duplicateEntryId: duplicate === undefined ? null : String(duplicate['entry_id']),
        createdAt: now,
        updatedAt: now,
      };
      db.run(
        `INSERT INTO money_drafts (id, request_id, attachment_id, sha256, entry_id, metadata)
        VALUES ($id, $requestId, $attachmentId, $sha, NULL, $metadata)`,
        {
          id: draft.id,
          requestId: input.requestId,
          attachmentId: input.attachmentId,
          sha: input.sha256,
          metadata: JSON.stringify(draft),
        },
      );
      return draft;
    },
    /** The reading run first (askId null); the card later, only when a draft has to ask (第二批). */
    link(id: string, version: number, askId: string | null, runId: string | null): MoneyDraft {
      const row = writable(id, version);
      return save({ ...row, askId, runId: runId ?? row.runId });
    },
    /**
     * 《置信度与做事方式改动方案》第二批「记账直接记」：识别清楚的截图由系统直接入账，没有设备确认
     * （confirmedByDeviceId 留空，和你签名确认的分得开）。
     */
    recordDirectly(id: string, version: number, entryId: string, fields: PaymentFields, basis: string): MoneyDraft {
      return save({ ...writable(id, version), status: 'confirmed', entryId, confirmedByDeviceId: null,
        candidate: { ...fields, basis, uncertainty: '' }, error: null });
    },
    /** Recorded drafts (by you or directly), oldest first: their originals are kept until you clear them. */
    recorded(): MoneyDraft[] {
      return db.all(`SELECT metadata FROM money_drafts WHERE entry_id IS NOT NULL
        AND json_extract(metadata, '$.status') = 'confirmed' ORDER BY json_extract(metadata, '$.createdAt'), id`)
        .map(read);
    },
    /** `duplicateEntryId`: an entry for the same payment found after reading (the same image is found on create). */
    propose(id: string, version: number, candidate: PaymentCandidate, error: string | null = null,
      duplicateEntryId?: string | null): MoneyDraft {
      checked(PaymentCandidateSchema, candidate, 'invalid_input', '记账候选');
      const row = writable(id, version);
      return save({ ...row, candidate, status: error === null ? 'ready' : 'failed', error,
        duplicateEntryId: duplicateEntryId ?? row.duplicateEntryId });
    },
    reject(id: string, version: number): MoneyDraft {
      return save({ ...writable(id, version), status: 'rejected' });
    },
    confirm(
      id: string,
      version: number,
      entryId: string,
      fields: PaymentFields,
      confirmation: DeviceConfirmation,
    ): MoneyDraft {
      const proof = requireConfirmation(confirmation);
      const row = writable(id, version);
      return save({
        ...row,
        status: 'confirmed',
        entryId,
        confirmedByDeviceId: proof.deviceId,
        candidate: { ...fields, basis: '', uncertainty: '' },
        error: null,
      });
    },
    reading(): MoneyDraft[] {
      return db.all("SELECT metadata FROM money_drafts WHERE json_extract(metadata, '$.status') = 'reading'").map(read);
    },
  };
}
