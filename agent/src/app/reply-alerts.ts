// 新消息通知从哪来（第13批，11-14 Aaron 定）：一条线这一轮做完了（lines/ 的 turnEnded），联系人或群里来了一句
// （network/ 的 changed）。这里只挑「该不该通知、写什么」，发和合并在 attention/message-alerts.ts。
// - 线：主线、队友、群组、旁聊，这一轮是他自己说的那句开的（origin user）才通知；主线派给队友（delegation）、定时和
//   后台线都不通知（后台线没做成照旧走主线的系统通知）。
// - 联系人：对方本人发来的文字（一对一、群里）；对方的 AI 代答、任务卡、系统说明、表情都不通知；读过的不通知。

import type { ContactAlert, LineAlert } from '../attention/message-alerts.ts';
import { mainIdentity } from '../mates/main-identity.ts';
import type { NetworkChange } from '../network/index.ts';
import type { LineRow, StateService } from '../state/index.ts';
import { faceOf } from './group-views.ts';

export type LineAlertState = Pick<StateService, 'lineMessages' | 'mates' | 'mateGroups' | 'kernelSettings'>;

/** 这条线这一轮的回复该不该通知；该就给标题（谁）、哪一句、开头。 */
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

/** 一次联系人改动里该通知的那几句（对方本人发来的、还没读的文字）。 */
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
