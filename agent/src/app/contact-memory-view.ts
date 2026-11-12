// 资料栏「记忆」一节（第 12 批，11-12 Aaron 定）：联系人绑的记忆人物页、那一页最近几行（谁说的：人物页的名字、你，或 Plasticine 推断）、
// 没绑时 Plasticine 觉得可能是哪一页（名字、@账号、备注出现在那一页的标题或行里；答过「不是」就不再问），
// 和能选的人物页（选的时候看到每页已经绑了谁）。人物页只在本机：不进对外可见的材料（visibility.ts 另有规矩）。

import type { ContactMemory } from '../../shared/api/index.ts';
import type { Contact, MemoryDoc } from '../../shared/state.ts';
import type { MemoryLineBasis } from '../../shared/state-memory-docs.ts';
import type { StateService } from '../state/index.ts';

const LINES_SHOWN = 3;

function normal(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/** 这个联系人的几种叫法（名字、备注、@账号），太短的不算。 */
function namesOf(contact: Contact): string[] {
  return [contact.displayName, contact.alias ?? '', contact.handle].map(normal)
    .filter((name) => name.length >= 2);
}

/** 没绑、也没答过「不是」时，最像的那一页人物；一页都不像就是 null。 */
export function suggestPerson(state: StateService, contact: Contact, people: readonly MemoryDoc[]): MemoryDoc | null {
  if (contact.personDocId !== null || contact.linkDismissedAt !== null) return null;
  const names = namesOf(contact);
  if (names.length === 0) return null;
  for (const doc of people) {
    const title = normal(doc.title);
    if (names.some((name) => title.length >= 2 && (name.includes(title) || title.includes(name)))) return doc;
    const text = normal([doc.summary, ...state.memoryDocs.lines.live(doc.id).map((line) => line.text)].join('\n'));
    if (names.some((name) => text.includes(name))) return doc;
  }
  return null;
}

/** 一行是谁说的：对方自己说的写人物页的名字，你说的写「你说的」，Plasticine 推的写「推断」。 */
function tagOf(basis: MemoryLineBasis, title: string): string {
  switch (basis) {
    case 'contact_stated': return `${title}说的`;
    case 'stated': return '你说的';
    case 'confirmed_inference': return '推断';
    case 'system': return '系统默认';
  }
}

export function contactMemory(state: StateService, contact: Contact): ContactMemory {
  const people = state.memoryDocs.docs.live().filter((doc) => doc.kind === 'person');
  const doc = contact.personDocId === null ? undefined : state.memoryDocs.docs.get(contact.personDocId);
  const lines = doc === undefined ? [] : state.memoryDocs.lines.live(doc.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, LINES_SHOWN)
    .map((line) => ({ text: line.text, by: tagOf(line.basis, doc.title), at: line.createdAt }));
  const suggested = doc === undefined ? suggestPerson(state, contact, people) : null;
  const linkedNames = (id: string): string[] => state.contacts.forPersonDoc(id)
    .map((row) => row.alias ?? row.displayName);
  return {
    doc: doc === undefined ? null : { id: doc.id, title: doc.title },
    suggest: suggested === null ? null : { id: suggested.id, title: suggested.title },
    lines,
    people: people.map((person) => ({ id: person.id, title: person.title, linked: linkedNames(person.id) })),
  };
}
