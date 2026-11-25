import type { ContactAlert, LineAlert } from '../attention/index.ts';
import { mainIdentity } from '../mates/index.ts';
import type { NetworkChange } from '../network/index.ts';
import type { LineRow, StateService } from '../state/index.ts';
import { faceOf } from './group-views.ts';

export type LineAlertState = Pick<StateService, 'lineMessages' | 'mates' | 'mateGroups' | 'kernelSettings'>;

export function lineReplyAlert(state: LineAlertState, line: LineRow): LineAlert | null {
  if (line.kind === 'background' || line.archivedAt !== null) return null;
  const asked = state.lineMessages.last(line.id, 'user');
  if (asked === undefined || asked.meta?.origin?.kind !== 'user') return null;
  const reply = state.lineMessages.last(line.id, 'assistant');
  if (reply === undefined || reply.seq < asked.seq) return null;
  const text = state.lineMessages.said(`line:${line.id}:${reply.seq}`)?.text ?? '';
  const named = line.mateId != null ? state.mates.get(line.mateId)?.name
    : line.mateGroupId != null ? state.mateGroups.get(line.mateGroupId)?.name : undefined;
  const kind = line.mateId != null || line.mateGroupId != null ? 'mate' : 'main';
  return { lineId: line.id, kind, seq: reply.seq, name: named ?? mainIdentity(state).name, text };
}

export function contactAlerts(state: StateService, change: NetworkChange): ContactAlert[] {
  if (change.groupId !== undefined) {
    const group = state.groups.get(change.groupId);
    if (group === undefined) return [];
    return change.messageIds.flatMap((id) => {
      const message = state.groupMessages.get(id);
      if (message === undefined || message.author !== 'them' || message.kind !== 'text' || message.readAt != null) {
        return [];
      }
      return [{ contactId: group.id, name: group.name, messageId: message.id, text: message.text,
        sender: faceOf(state, message.authorAccountId).name, group: true }];
    });
  }
  const contact = state.contacts.get(change.contactId);
  if (contact === undefined) return [];
  return change.messageIds.flatMap((id) => {
    const message = state.contactMessages.get(id);
    if (message === undefined || message.direction !== 'in' || message.author !== 'them' || message.kind !== 'text'
      || message.readAt != null || message.groupId != null) {
      return [];
    }
    return [{ contactId: contact.id, name: contact.alias ?? contact.displayName, messageId: message.id,
      text: message.text, sender: null, group: false }];
  });
}
