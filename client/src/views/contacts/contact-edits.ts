// 第 12 批：联系人上的几笔小写操作——给一句加表情、改备注、绑记忆里的人物页、删除和恢复。都是一次点击就完的事，
// 不进待核实列表：成了就换上新的一行、重读资料；没成把原因交回去，由点的那处就地说（版本过时先换上最新的一行）。

import { Value } from 'typebox/value';
import type { PlasticineApi } from '../../api/client.ts';
import { ApiError, ConflictError } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import { CONTACT_REACTIONS, ContactRowSchema, type ContactRow } from '../../api/shared.ts';
import type { ContactsStore } from './contacts-store.ts';

/** 联系人和群里能加的表情。 */
export const REACTIONS = CONTACT_REACTIONS;
export type Reaction = (typeof REACTIONS)[number];

/** 绑人物页：选一页（null = 解绑）、新建一页、答「不是」。 */
export type PersonChoice = { docId: string | null } | { create: string } | { dismiss: true };

/** 没成时交回的一句话；成了是 null。 */
export type EditResult = string | null;

export class ContactEdits {
  private readonly api: PlasticineApi;
  private readonly store: ContactsStore;

  constructor(api: PlasticineApi, store: ContactsStore) {
    this.api = api;
    this.store = store;
  }

  react(threadId: string, messageId: string, emoji: Reaction, on: boolean): Promise<EditResult> {
    return this.attempt(async () => {
      await this.api.contacts.react(threadId, messageId, { requestId: createRequestId(), emoji, on });
    });
  }

  rename(contact: ContactRow, alias: string): Promise<EditResult> {
    const text = alias.trim();
    return this.row(contact.id, () => this.api.contacts.setAlias(contact.id,
      { requestId: createRequestId(), version: contact.version, alias: text === '' ? null : text }));
  }

  link(contact: ContactRow, choice: PersonChoice): Promise<EditResult> {
    return this.row(contact.id, () => this.api.contacts.setPerson(contact.id,
      { requestId: createRequestId(), version: contact.version, ...choice }));
  }

  remove(contact: ContactRow): Promise<EditResult> {
    return this.row(contact.id, async () => {
      const row = await this.api.contacts.remove(contact.id, { requestId: createRequestId() });
      void this.store.list.reload();
      return row;
    });
  }

  restore(contact: ContactRow): Promise<EditResult> {
    return this.row(contact.id, async () => {
      const row = await this.api.contacts.restore(contact.id, { requestId: createRequestId() });
      void this.store.list.reload();
      return row;
    });
  }

  private row(id: string, work: () => Promise<ContactRow>): Promise<EditResult> {
    return this.attempt(async () => {
      this.store.putRow(await work());
      void this.store.detail(id).reload();
    });
  }

  private async attempt(work: () => Promise<void>): Promise<EditResult> {
    try {
      await work();
      return null;
    } catch (cause) {
      if (cause instanceof ConflictError && Value.Check(ContactRowSchema, cause.current)) {
        this.store.putRow(cause.current);
      }
      if (cause instanceof ApiError) {
        return cause.next === undefined ? cause.message : `${cause.message}${cause.next}`;
      }
      return '没有改成，再试一次。';
    }
  }
}
