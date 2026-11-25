import type { ContactRow } from '../../api/shared.ts';

export function theirAi(contact: Pick<ContactRow, 'name' | 'aiName'>): string {
  return `${contact.name}的 ${contact.aiName ?? 'Plasticine'}`;
}
