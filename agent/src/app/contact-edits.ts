// /v2/contacts/:id/{alias,person,remove,restore} 和 /messages/:messageId/reaction（第 12 批，11-12 Aaron 定）：
// 改备注、绑 / 新建 / 解绑记忆人物页、答「不是」、删除和恢复联系人、给一句话加表情。都按 requestId 幂等。

import {
  ContactAliasRequestSchema,
  ContactPersonRequestSchema,
  ContactReactionRequestSchema,
  ContactRemoveRequestSchema,
} from '../../shared/api/index.ts';
import type { Contact } from '../../shared/state.ts';
import { docEvent } from '../brain/memory-doc-writes.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { withCurrent } from './conflict.ts';
import { requireNetwork } from './contacts.ts';
import { personRow } from './contact-views.ts';
import { param, requireUserAuth, type Reply, type RequestContext } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { checkInput } from './validate.ts';
import { isGroupId, requireGroupRow } from './groups.ts';

function person(context: RequestContext, id: string): Contact {
  const contact = context.deps.state.contacts.get(id);
  if (contact === undefined) throw notFoundError('这个联系人');
  return contact;
}

function reply(context: RequestContext, contact: Contact): Reply {
  return { status: 200, body: { contact: personRow(context.deps.state, contact) } };
}

/** POST /v2/contacts/:id/alias */
export async function setContactAlias(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ContactAliasRequestSchema, await readJsonBody(context.req), '改备注');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  person(context, id);
  return idempotent(context, body.requestId, () => reply(context, withCurrent(
    () => network.setAlias(id, body.version, body.alias),
    () => personRow(context.deps.state, person(context, id)), () => person(context, id).version)));
}

/** POST /v2/contacts/:id/person：绑一页、新建一页再绑、解绑、答「不是」。 */
export async function setContactPerson(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ContactPersonRequestSchema, await readJsonBody(context.req), '关联人物');
  const { state } = context.deps;
  const id = param(context, 'id');
  person(context, id);
  return idempotent(context, body.requestId, () => reply(context, withCurrent(() => state.transaction(() => {
    const current = person(context, id);
    if (body.dismiss === true) {
      return state.contacts.update(id, body.version, { linkDismissedAt: new Date().toISOString() });
    }
    let docId = body.docId ?? null;
    if (body.create !== undefined) {
      const doc = state.memoryDocs.docs.create({ kind: 'person', title: body.create.trim(),
        summary: `联系人 ${current.alias ?? current.displayName}（@${current.handle}）`, createdBy: 'user' });
      docEvent(state, doc.id, null, 'doc_created', { actor: 'user', ref: null }, { title: doc.title });
      docId = doc.id;
    } else if (docId !== null && state.memoryDocs.docs.get(docId)?.kind !== 'person') {
      throw new ApiError(404, 'not_found', '没有这一页人物。');
    }
    return state.contacts.update(id, body.version, { personDocId: docId });
  }), () => personRow(state, person(context, id)), () => person(context, id).version)));
}

/** POST /v2/contacts/:id/remove：删除联系人（不通知对方，「最近删除」里能恢复）。 */
export async function removeContactRoute(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ContactRemoveRequestSchema, await readJsonBody(context.req), '删除联系人');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  person(context, id);
  return idempotent(context, body.requestId, () => reply(context, network.removeContact(id)));
}

/** POST /v2/contacts/:id/restore */
export async function restoreContactRoute(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ContactRemoveRequestSchema, await readJsonBody(context.req), '恢复联系人');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  person(context, id);
  return idempotent(context, body.requestId, () => reply(context, network.restoreContact(id)));
}

/** POST /v2/contacts/:id/messages/:messageId/reaction：id 是联系人或群。 */
export async function reactToMessage(context: RequestContext): Promise<Reply> {
  requireUserAuth(context);
  const body = checkInput(ContactReactionRequestSchema, await readJsonBody(context.req), '加表情');
  const network = requireNetwork(context.deps);
  const id = param(context, 'id');
  const threadId = isGroupId(id) ? requireGroupRow(context.deps, id).id : id;
  const messageId = param(context, 'messageId');
  return idempotent(context, body.requestId, () => {
    network.react(threadId, messageId, body.emoji, body.on);
    return { status: 200, body: { ok: true } };
  });
}
