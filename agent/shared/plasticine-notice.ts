import type { InboxSource } from './state.ts';

export const PLASTICINE_NOTICE_SOURCE = 'plasticine' satisfies InboxSource;

export function isPlasticineNotice(message: { source: InboxSource }): boolean {
  return message.source === PLASTICINE_NOTICE_SOURCE;
}
