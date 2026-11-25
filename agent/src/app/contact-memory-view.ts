import type { ContactMemory } from '../../shared/api/index.ts';
import type { Contact, MemoryDoc } from '../../shared/state.ts';
import type { MemoryLineBasis } from '../../shared/state-memory-docs.ts';
import type { StateService } from '../state/index.ts';

const LINES_SHOWN = 3;

function normal(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

function namesOf(contact: Contact): string[] {
  return [contact.displayName, contact.alias ?? '', contact.handle].map(normal)
    .filter((name) => name.length >= 2);
}

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

function tagOf(basis: MemoryLineBasis, title: string): string {
  switch (basis) {
    case 'contact_stated': return `${title}说的`;
    case 'stated': return '你说的';
    case 'confirmed_inference': return '推断';
    case 'system': return '系统默认';
    case 'tried': return 'Plasticine 试出来的';
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
