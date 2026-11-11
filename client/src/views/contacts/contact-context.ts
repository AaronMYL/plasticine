// 悬浮对话框看得见当前标签（第 107、111 条，设计稿 Desktop-Receive：在周可的标签上问「这条值得接吗」）：联系人标签上点
// 「问这一页」，带上的引用片不是一句地址，而是这一页上看得见的东西——这人是谁、什么关系，等你的和在做的任务（要做到什么、
// 验收看到什么、期限），最近几句。不点就不带。

import type { ContactMessageView, ContactRow, ContactThreadItem } from '../../api/shared.ts';
import { CONTACT_RELATION_LABELS } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { Store } from '../../state/store.ts';
import { useStore } from '../../state/use-store.ts';
import type { Route } from '../../shell/routes.ts';
import { routeHash } from '../../shell/routes.ts';
import type { Resource } from '../m5b/resource-store.ts';
import type { ContactMessagesResponse } from '../../api/shared.ts';
import { deadlineText } from './contact-time.ts';

/** 引用片里带最近几句。 */
const RECENT_LINES = 6;
const OPEN_TASK_STATES: ReadonlySet<string> = new Set(['offered', 'accepted', 'in_progress', 'delivered']);

function speaker(author: string, name: string): string {
  switch (author) {
    case 'me':
      return '我';
    case 'my_ai':
      return '我的 Plasticine';
    case 'their_ai':
      return `${name}的 Plasticine`;
    case 'system':
      return '系统';
    default:
      return name;
  }
}

export function contactQuoteText(contact: ContactRow, items: readonly ContactThreadItem[], hash: string,
  when: (iso: string) => string): string {
  const who = [contact.handle === null ? null : `@${contact.handle}`,
    contact.relation === null ? null : CONTACT_RELATION_LABELS[contact.relation], contact.address]
    .filter((part) => part !== null).join('，');
  const lines = [`联系人：${contact.name}${who === '' ? '' : `（${who}）`}`];
  for (const item of items) {
    if (item.type !== 'task' || !OPEN_TASK_STATES.has(item.task.state)) {
      continue;
    }
    const { task } = item;
    const head = task.waiting ? '等你' : '进行中';
    const from = task.direction === 'in' ? `${contact.name}发来` : '我发出';
    const deadline = task.deadline === null ? '' : `，期限 ${when(task.deadline)}`;
    lines.push(`${head}：${task.title}（${from}${deadline}）`, `  要做到：${task.goal}`, `  验收：${task.acceptance}`);
  }
  const recent = items.flatMap((item) => (item.type === 'message' ? [item.message] : [])).slice(-RECENT_LINES);
  if (recent.length > 0) {
    // 邮件的标题和正文分开给（2026-11-04）：标题放回句首。
    const said = (message: ContactMessageView) => message.mail === undefined ? message.text
      : `「${message.mail.subject}」${message.text}`;
    lines.push('最近：', ...recent.map((message) => `  ${speaker(message.author, contact.name)}：${said(message)}`));
  }
  lines.push(hash);
  return lines.join('\n');
}

const NOTHING = new Store<Resource<ContactMessagesResponse>>({ status: 'idle', error: null, value: null });

/** 当前标签是和某个联系人的聊天：给出引用片的字；别的标签是 null。 */
export function useContactQuote(route: Route | null): string | null {
  const { contacts } = useLive();
  const timeZone = useTimeZone();
  const list = useStore(contacts.list.data);
  const id = route?.view === 'messages' || route?.view === 'contacts' ? route.contactId ?? null : null;
  const thread = useStore(id === null ? NOTHING : contacts.thread(id).latest.data);
  if (id === null || route === null) {
    return null;
  }
  const contact = list.value?.contacts.find((row) => row.id === id);
  if (contact === undefined) {
    return null;
  }
  const now = new Date();
  return contactQuoteText(contact, thread.value?.items ?? [], routeHash(route),
    (iso) => deadlineText(iso, now, timeZone));
}
