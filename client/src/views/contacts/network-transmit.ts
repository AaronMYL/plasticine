import type { PlasticineApi } from '../../api/client.ts';
import type { GroupTaskView, NetworkTaskView } from '../../api/shared.ts';
import type { ActionRequest } from '../../state/action-ops.ts';
import { GROUP_CREATE_OP_KEY, groupOpKey } from '../../state/contacts-action-requests.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import type { ContactsStore } from './contacts-store.ts';

export interface TransmitDeps {
  api: PlasticineApi;
  store: ContactsStore;
  drafts: InlineDrafts;
  onProfile?: () => void;
}

export function groupDraftKey(field: 'name' | 'query'): string {
  return `${GROUP_CREATE_OP_KEY}:${field}`;
}

export function groupNameDraftKey(groupId: string): string {
  return `${groupOpKey(groupId, 'update')}:name`;
}

export function applyGroupTask(store: ContactsStore, task: GroupTaskView): void {
  store.thread(task.groupId).put({ type: 'group_task', at: task.offeredAt, task });
  void store.list.reload();
}

function applyTask(store: ContactsStore, task: NetworkTaskView): void {
  store.thread(task.contactId).put({ type: 'task', at: task.createdAt, task });
  void store.detail(task.contactId).reload();
  void store.list.reload();
}

export async function transmitNetwork(deps: TransmitDeps, request: ActionRequest,
  onCreated?: (id: string) => void): Promise<boolean> {
  const { api, store, drafts } = deps;
  switch (request.kind) {
    case 'group_create': {
      const row = await api.contacts.createGroup(request.body);
      drafts.clear(groupDraftKey('name'));
      drafts.clear(groupDraftKey('query'));
      store.putRow(row);
      void store.list.reload();
      onCreated?.(row.id);
      return true;
    }
    case 'group_update':
    case 'group_leave': {
      const row = request.kind === 'group_update' ? await api.contacts.updateGroup(request.groupId, request.body)
        : await api.contacts.leaveGroup(request.groupId, request.body);
      drafts.clear(groupNameDraftKey(request.groupId));
      store.putRow(row);
      void store.detail(request.groupId).reload();
      void store.thread(request.groupId).latest.reload();
      void store.list.reload();
      return true;
    }
    case 'group_task': {
      applyGroupTask(store, await api.contacts.createGroupTask(request.contactId, request.body));
      return true;
    }
    case 'group_task_claim':
      applyGroupTask(store, await api.groupTasks.claim(request.taskId, request.body));
      return true;
    case 'group_task_cancel':
      applyGroupTask(store, await api.groupTasks.cancel(request.taskId, request.body));
      return true;
    case 'network_task_cancel':
      applyTask(store, await api.networkTasks.cancel(request.taskId, request.body));
      return true;
    case 'network_task_stop':
      applyTask(store, await api.networkTasks.stop(request.taskId, request.body));
      return true;
    case 'network_avatar':
      await api.network.setAvatar(request.body);
      deps.onProfile?.();
      return true;
    default:
      return false;
  }
}
