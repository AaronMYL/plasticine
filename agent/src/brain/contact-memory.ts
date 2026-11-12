// 联系人说的话进人物页（第 12 批，11-12 Aaron 定）：绑了记忆人物页的联系人在聊天里说到关于自己、一个月后还成立的事，
// 记成那一页里的一行，依据是 contact_stated（界面写「<人物页名字>说的」，不用他 / 她），锚点链回那一句。
// 只看最近两天进来的话（刚绑上不翻旧账）；每一句一份整理（key = contact:<消息 id>，排过的不再排）。

import { Type, type Static } from 'typebox';
import type { ContactMessage, MemoryJob, MemoryJobResult } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { askJson, type BookModel } from './book-model.ts';
import { addLine } from './memory-doc-writes.ts';

/** 往回看多久进来的话。 */
export const CONTACT_MEMORY_WINDOW_MS = 48 * 3600_000;
const RECENT = 30;
const LINES_MAX = 3;

export const ContactFactsSchema = Type.Object({
  lines: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { maxItems: LINES_MAX }),
});
export type ContactFacts = Static<typeof ContactFactsSchema>;

const SYSTEM = [
  '你在帮用户整理记忆里的一页人物。下面是这位联系人在聊天里亲口说的一句话，和这页人物已经记着的几行。',
  '只挑这句话里对方明确说到的、关于对方自己、一个月后还成立的事（住处、工作、计划、偏好、关系、近况）。',
  '每件事写成一行简短的陈述，主语用人物页的名字，不用「他 / 她」；不写推测，不写寒暄，不重复已经记着的。',
  '没有值得记的就给空数组。只回 JSON：{"lines": ["……"]}。',
].join('\n');

/** 绑了人物页的联系人最近两天进来、还没排过整理的话。 */
export function contactMemorySources(state: StateService, now: Date): { message: ContactMessage; docId: string }[] {
  const since = new Date(now.getTime() - CONTACT_MEMORY_WINDOW_MS).toISOString();
  const out: { message: ContactMessage; docId: string }[] = [];
  for (const contact of state.contacts.all()) {
    const docId = contact.personDocId;
    if (docId === null || state.memoryDocs.docs.get(docId) === undefined) continue;
    for (const message of state.contactMessages.recent(contact.id, RECENT)) {
      if (message.direction !== 'in' || message.kind !== 'text' || message.author !== 'them'
        || message.sentAt < since || message.text.trim().length < 4) continue;
      if (state.memoryCuration.jobs.byKey(contactJobKey(message.id)) !== undefined) continue;
      out.push({ message, docId });
    }
  }
  return out;
}

export function contactJobKey(messageId: string): string {
  return `contact:${messageId}`;
}

/** 做一份：问模型，写进人物页。消息或人物页没了就什么都不写。 */
export async function runContactJob(state: StateService, model: BookModel, job: MemoryJob, signal: AbortSignal):
  Promise<{ result: MemoryJobResult; docIds: string[] }> {
  const messageId = job.sourceIds[0];
  const message = messageId === undefined ? undefined : state.contactMessages.get(messageId);
  const doc = job.docId == null ? undefined : state.memoryDocs.docs.get(job.docId);
  if (message === undefined || doc === undefined) {
    return { result: { applied: 0, rejected: [], note: '那一句或人物页已经不在了。' }, docIds: [] };
  }
  const known = state.memoryDocs.lines.live(doc.id).map((line) => `- ${line.text}`).join('\n');
  const material = `人物页：${doc.title}\n已经记着：\n${known === '' ? '（还没有）' : known}\n\n对方说：${message.text}`;
  const facts = await askJson(model, ContactFactsSchema, SYSTEM, material, signal, 'memory_curate');
  const written = state.transaction(() => facts.lines.map((text) => text.trim()).filter((text) => text !== '')
    .map((text) => addLine(state, { docId: doc.id, text, basis: 'contact_stated',
      anchors: [{ kind: 'contact_message', ref: message.id }] }, { actor: 'brain', ref: job.id })));
  return { result: { applied: written.length, rejected: [] }, docIds: written.length === 0 ? [] : [doc.id] };
}
