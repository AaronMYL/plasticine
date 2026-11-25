import type { ContactListResponse, ContactRow } from '../../shared/api/index.ts';
import type { InboxMessage } from '../../shared/state.ts';
import type { NetworkChange } from '../network/index.ts';
import type { StateService } from '../state/index.ts';
import { inboxContactId, inboxMessageItem, inboxRows } from './contact-mail.ts';
import { listed, networkTaskView, personRow, threadItemFor, type TaskActivity, type TaskExecution }
  from './contact-views.ts';
import type { EventHub } from './event-hub.ts';
import { groupItemOf, groupRow, groupTaskView } from './group-views.ts';

interface StreamDeps {
  state: StateService;
  hub: EventHub;
  activity?: TaskActivity;
  execution?: TaskExecution;
}

function byRecent(a: ContactRow, b: ContactRow): number {
  const at = (row: ContactRow): number => (row.last === null ? 0 : Date.parse(row.last.at));
  return at(b) - at(a);
}

export function contactList(state: StateService): ContactListResponse {
  const people = state.contacts.all().filter(listed).map((contact) => personRow(state, contact));
  const groups = state.groups.active().map((group) => groupRow(state, group));
  const contacts = [...people, ...groups, ...inboxRows(state)].sort(byRecent);
  return {
    contacts,
    requests: people.filter((row) => row.state === 'request').length,
    waiting: contacts.filter((row) => row.waiting).length,
    unread: contacts.reduce((sum, row) => sum + row.unread, 0),
    removed: state.contacts.removed().map((contact) => personRow(state, contact)),
  };
}

function publishTotals(deps: StreamDeps): void {
  const list = contactList(deps.state);
  deps.hub.publish({ type: 'contacts_changed', waiting: list.waiting, unread: list.unread });
}

function publishGroupChange(deps: StreamDeps, groupId: string, change: NetworkChange): void {
  const { state, hub } = deps;
  for (const messageId of change.messageIds) {
    const message = state.groupMessages.get(messageId);
    const item = message === undefined ? null : groupItemOf(state, message, deps.activity, deps.execution);
    if (item !== null) {
      hub.publish({ type: 'contact_item', contactId: groupId, item });
    }
  }
  for (const taskId of change.taskIds) {
    const task = state.groupTasks.get(taskId);
    const placed = task === undefined ? undefined : state.groupMessages.byMessageId(task.groupId, `task-${task.id}`);
    if (task !== undefined) {
      hub.publish({ type: 'contact_item', contactId: groupId,
        item: { type: 'group_task', at: placed?.sentAt ?? task.offeredAt,
          task: groupTaskView(state, task, deps.activity, deps.execution) } });
    }
  }
}

export function publishNetworkChange(deps: StreamDeps, change: NetworkChange): void {
  const { state, hub } = deps;
  publishTotals(deps);
  if (change.groupId !== undefined) {
    publishGroupChange(deps, change.groupId, change);
    return;
  }
  for (const messageId of change.messageIds) {
    const message = state.contactMessages.get(messageId);
    const item = message === undefined ? null : threadItemFor(state, message, deps.activity, deps.execution);
    if (item !== null) {
      hub.publish({ type: 'contact_item', contactId: change.contactId, item });
    }
  }
  for (const taskId of change.taskIds) {
    const task = state.networkTasks.get(taskId);
    if (task !== undefined) {
      const offered = state.contactMessages.forTask(task.id).find((row) => row.kind === 'task_offer');
      hub.publish({ type: 'contact_item', contactId: task.contactId,
        item: { type: 'task', at: offered?.sentAt ?? task.offeredAt,
          task: networkTaskView(task, deps.activity, deps.execution) } });
    }
  }
}

export function publishInboxContact(deps: StreamDeps, message: InboxMessage): void {
  const contactId = inboxContactId(message);
  if (contactId === null) {
    return;
  }
  publishTotals(deps);
  deps.hub.publish({ type: 'contact_item', contactId, item: { type: 'message', message: inboxMessageItem(message) } });
}
