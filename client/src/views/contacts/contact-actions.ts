// 联系人上的写操作（第 113 条）：发一句（含问对方的 Plasticine、回邮件）、加人、处理新请求、改关系、发任务；对方发来的任务
// 表态、我来做的交付、验收。标识和整个请求体存在 state/action-ops（回执丢了、401、切页、刷新之后原样重发，没了结时同一处
// 不让给出新内容）；字在 inline-drafts（按操作 key），拿到结果才清。标已读是背景里的一笔，不进待核实列表，失败只记一笔。

import { Value } from 'typebox/value';
import type { PlasticineApi } from '../../api/client.ts';
import { ConflictError } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import {
  ContactRowSchema,
  NetworkTaskViewSchema,
  type ContactRelation,
  type ContactRow,
  type GroupTaskView,
  type NetworkTaskView,
  type UpdateGroupRequestSchema,
} from '../../api/shared.ts';
import type { Static } from 'typebox';
import type { ActionOps, ActionRequest } from '../../state/action-ops.ts';
import {
  CONTACT_ADD_OP_KEY,
  contactOpKey,
  GROUP_CREATE_OP_KEY,
  groupOpKey,
  groupTaskOpKey,
  NETWORK_AVATAR_OP_KEY,
  networkTaskOpKey,
} from '../../state/contacts-action-requests.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import type { ContactsStore } from './contacts-store.ts';
import { groupDraftKey, transmitNetwork } from './network-transmit.ts';

export interface ContactActionsDeps {
  api: PlasticineApi;
  store: ContactsStore;
  ops: ActionOps;
  drafts: InlineDrafts;
  onProfile?: () => void;
}

/** 发任务面板交来的：要做到什么（第一句当标题）、期限、资料、群里指给谁。 */
export interface TaskInput {
  goal: string;
  deadline: string | null;
  attachment: string | null;
  assignee: string | null;
}

/** 标题最多这么多字（接口 120；卡上一两行放得下）。 */
const TITLE_MAX_CHARS = 60;

/** 「要做到什么」的第一行（第一句）当标题；只有一句时标题就是它。 */
export function titleOf(goal: string): string {
  const first = goal.trim().split('\n')[0] ?? '';
  const sentence = /^[^。！？!?]*[。！？!?]?/.exec(first)?.[0] ?? first;
  const chars = Array.from(sentence.trim().replace(/[。！？!?]$/, ''));
  return chars.length <= TITLE_MAX_CHARS ? chars.join('') : `${chars.slice(0, TITLE_MAX_CHARS - 1).join('')}…`;
}

export type TaskField = 'title' | 'goal' | 'acceptance' | 'deadline';

/** 发任务表单一个字段的草稿 key（`contact:<id>:task:title`）。 */
export function taskDraftKey(contactId: string, field: TaskField): string {
  return `${contactOpKey(contactId, 'task')}:${field}`;
}

export function addDraftKey(field: 'handle' | 'note'): string {
  return `${CONTACT_ADD_OP_KEY}:${field}`;
}

/** datetime-local 的字（本机时间）→ ISO；空的或认不出的是 null。 */
export function deadlineOf(text: string): string | null {
  if (text.trim() === '') {
    return null;
  }
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export class ContactActions {
  private readonly deps: ContactActionsDeps;

  constructor(deps: ContactActionsDeps) {
    this.deps = deps;
  }

  async retry(key: string): Promise<void> {
    const request = this.deps.ops.retry(key);
    if (request !== undefined) {
      await this.perform(key, request);
    }
  }

  dismiss(key: string): void {
    this.deps.ops.dismiss(key);
  }

  /**
   * 发输入框里那一句：target ai = 问对方的 Plasticine，mine = @ 我自己的；群里 aiOf = 问谁的 Plasticine（账号 id）。
   * 邮件联系人由服务端回最近一封。
   */
  async send(contact: ContactRow, target: 'person' | 'ai' | 'mine', aiOf: string | null = null): Promise<boolean> {
    const key = contactOpKey(contact.id, 'send');
    const text = this.deps.drafts.get(key).trim();
    if (text === '') {
      return false;
    }
    const asking = target !== 'person' || aiOf !== null;
    return this.run(key, asking ? '问 Plasticine' : '发送', contact.name, (requestId) => ({
      kind: 'contact_send',
      contactId: contact.id,
      body: aiOf !== null ? { requestId, text, aiOf } : target === 'person' ? { requestId, text }
        : { requestId, text, target },
    }));
  }

  /** 发任务面板的「发出」：一对一发给这个人；群里指给某人或全群谁先接谁做。 */
  async sendTask(contact: ContactRow, input: TaskInput): Promise<boolean> {
    const goal = input.goal.trim();
    if (goal === '') {
      return false;
    }
    const title = titleOf(goal);
    const group = contact.kind === 'group';
    return this.run(contactOpKey(contact.id, 'task'), '发任务', title, (requestId) => ({
      kind: group ? 'group_task' : 'contact_task',
      contactId: contact.id,
      body: { requestId, title, goal, deadline: input.deadline,
        ...(input.attachment === null ? {} : { attachment: input.attachment }),
        ...(group && input.assignee !== null ? { assignee: input.assignee } : {}) },
    }));
  }

  /** 建群：选的好友（联系人 id）和群名（可空）；成了返回群的 id。 */
  async createGroup(memberIds: readonly string[]): Promise<string | null> {
    if (memberIds.length === 0) {
      return null;
    }
    const name = this.deps.drafts.get(groupDraftKey('name')).trim();
    let created: string | null = null;
    await this.run(GROUP_CREATE_OP_KEY, '建群', name === '' ? '新群' : name, (requestId) => ({
      kind: 'group_create',
      body: name === '' ? { requestId, memberIds: [...memberIds] } : { requestId, name, memberIds: [...memberIds] },
    }), (id) => {
      created = id;
    });
    return created;
  }

  async updateGroup(group: ContactRow, change: Omit<Static<typeof UpdateGroupRequestSchema>, 'requestId'>):
    Promise<boolean> {
    return this.run(groupOpKey(group.id, 'update'), '改群', group.name, (requestId) => ({
      kind: 'group_update',
      groupId: group.id,
      body: { requestId, ...change },
    }));
  }

  async leaveGroup(group: ContactRow): Promise<boolean> {
    return this.run(groupOpKey(group.id, 'leave'), '退群', group.name, (requestId) => ({
      kind: 'group_leave',
      groupId: group.id,
      body: { requestId },
    }));
  }

  /** 群任务卡：我来接（person）/ 让 Plasticine 接（ai）。 */
  async claim(task: GroupTaskView, doer: 'ai' | 'person'): Promise<boolean> {
    return this.run(groupTaskOpKey(task.id, 'claim'), doer === 'ai' ? '让 Plasticine 接' : '我来接', task.title,
      (requestId) => ({ kind: 'group_task_claim', taskId: task.id, body: { requestId, doer } }));
  }

  async cancelGroupTask(task: GroupTaskView): Promise<boolean> {
    return this.run(groupTaskOpKey(task.id, 'cancel'), '撤回', task.title,
      (requestId) => ({ kind: 'group_task_cancel', taskId: task.id, body: { requestId } }));
  }

  /** 撤回我发出、对方还没点头的任务。 */
  async cancel(task: NetworkTaskView): Promise<boolean> {
    return this.run(networkTaskOpKey(task.id, 'cancel'), '撤回', task.title,
      (requestId) => ({ kind: 'network_task_cancel', taskId: task.id, body: { requestId, version: task.version } }));
  }

  /** 叫停我的 Plasticine，改成我自己做。 */
  async stop(task: NetworkTaskView): Promise<boolean> {
    return this.run(networkTaskOpKey(task.id, 'stop'), '停止', task.title,
      (requestId) => ({ kind: 'network_task_stop', taskId: task.id, body: { requestId, version: task.version } }));
  }

  /** 换头像（裁好的圆形小图，data URL）；null = 去掉。 */
  async setAvatar(avatar: string | null): Promise<boolean> {
    return this.run(NETWORK_AVATAR_OP_KEY, '换头像', '头像',
      (requestId) => ({ kind: 'network_avatar', body: { requestId, avatar } }));
  }

  /** 按 @handle 加人；成了返回新联系人的 id（界面跳过去）。 */
  async add(): Promise<string | null> {
    const handle = this.deps.drafts.get(addDraftKey('handle')).trim();
    if (handle === '') {
      return null;
    }
    const note = this.deps.drafts.get(addDraftKey('note')).trim();
    let added: string | null = null;
    await this.run(CONTACT_ADD_OP_KEY, '加联系人', handle, (requestId) => ({
      kind: 'contact_add',
      body: note === '' ? { requestId, handle } : { requestId, handle, note },
    }), (id) => {
      added = id;
    });
    return added;
  }

  async decideRequest(contact: ContactRow, decision: 'accept' | 'block' | 'ignore'): Promise<boolean> {
    const labels = { accept: '接受', block: '拉黑', ignore: '忽略' } as const;
    return this.run(contactOpKey(contact.id, 'request'), labels[decision], contact.name, (requestId) => ({
      kind: 'contact_request',
      contactId: contact.id,
      body: { requestId, decision },
    }));
  }

  async setRelation(contact: ContactRow, relation: ContactRelation): Promise<boolean> {
    if (contact.relation === relation) {
      return true;
    }
    return this.run(contactOpKey(contact.id, 'relation'), '改关系', contact.name, (requestId) => ({
      kind: 'contact_relation',
      contactId: contact.id,
      body: { requestId, version: contact.version, relation },
    }));
  }

  /** 当面或换个渠道核对过安全码：换上对方的新钥匙。没换成就照常报错，安全码变了的提醒留着。 */
  async confirmSafety(contact: ContactRow): Promise<boolean> {
    try {
      const row = await this.deps.api.contacts.confirmSafety(contact.id,
        { requestId: createRequestId(), version: contact.version });
      this.deps.store.putRow(row);
      void this.deps.store.detail(contact.id).reload();
      return true;
    } catch (cause) {
      this.onRefused(cause);
      return false;
    }
  }

  /** 打开了有未读的聊天：读到最后一项。背景里的一笔，失败只记下来，下次打开再标。 */
  async markRead(contact: ContactRow, upTo: string): Promise<void> {
    try {
      const row = await this.deps.api.contacts.read(contact.id, { requestId: createRequestId(), upTo });
      this.deps.store.putRow(row);
    } catch (cause) {
      console.warn(`没能把「${contact.name}」标成已读，下次打开再标`, cause);
    }
  }

  async createTask(contact: ContactRow): Promise<boolean> {
    const { drafts } = this.deps;
    const title = drafts.get(taskDraftKey(contact.id, 'title')).trim();
    const goal = drafts.get(taskDraftKey(contact.id, 'goal')).trim();
    const acceptance = drafts.get(taskDraftKey(contact.id, 'acceptance')).trim();
    if (title === '' || goal === '' || acceptance === '') {
      return false;
    }
    const deadline = deadlineOf(drafts.get(taskDraftKey(contact.id, 'deadline')));
    return this.run(contactOpKey(contact.id, 'task'), '发任务', title, (requestId) => ({
      kind: 'contact_task',
      contactId: contact.id,
      body: { requestId, title, goal, acceptance, deadline },
    }));
  }

  async decide(task: NetworkTaskView, decision: 'by_ai' | 'by_person' | 'decline'): Promise<boolean> {
    const labels = { by_ai: '让 Plasticine 做', by_person: '我来做', decline: '先不' } as const;
    return this.run(networkTaskOpKey(task.id, 'decide'), labels[decision], task.title, (requestId) => ({
      kind: 'network_task_decide',
      taskId: task.id,
      body: { requestId, version: task.version, decision },
    }));
  }

  async deliver(task: NetworkTaskView): Promise<boolean> {
    const key = networkTaskOpKey(task.id, 'deliver');
    const text = this.deps.drafts.get(key).trim();
    if (text === '') {
      return false;
    }
    return this.run(key, '交付', task.title, (requestId) => ({
      kind: 'network_task_deliver',
      taskId: task.id,
      body: { requestId, version: task.version, text },
    }));
  }

  async verdict(task: NetworkTaskView, verdict: 'pass' | 'reject'): Promise<boolean> {
    const key = networkTaskOpKey(task.id, 'verdict');
    const note = this.deps.drafts.get(key).trim();
    return this.run(key, verdict === 'pass' ? '收到' : '再改改', task.title, (requestId) => ({
      kind: 'network_task_verdict',
      taskId: task.id,
      body: note === '' ? { requestId, version: task.version, verdict } : { requestId, version: task.version,
        verdict, note },
    }));
  }

  private async run(key: string, label: string, subject: string, build: (requestId: string) => ActionRequest,
    onAdded?: (id: string) => void): Promise<boolean> {
    if (this.deps.ops.get(key)?.status === 'failed') {
      this.deps.ops.dismiss(key);
    }
    const request = this.deps.ops.begin(key, label, subject, build, createRequestId);
    return this.perform(key, request, onAdded);
  }

  private async perform(key: string, request: ActionRequest, onAdded?: (id: string) => void): Promise<boolean> {
    try {
      await this.transmit(request, onAdded);
      this.deps.ops.succeed(key);
      return true;
    } catch (cause) {
      this.deps.ops.fail(key, cause);
      this.onRefused(cause);
      return false;
    }
  }

  private async transmit(request: ActionRequest, onAdded?: (id: string) => void): Promise<void> {
    const { api, store, drafts } = this.deps;
    switch (request.kind) {
      case 'contact_send': {
        const message = await api.contacts.send(request.contactId, request.body);
        store.thread(request.contactId).put({ type: 'message', message });
        drafts.clearIfSent(contactOpKey(request.contactId, 'send'), request.body.text);
        void store.list.reload();
        return;
      }
      case 'contact_add': {
        const row = await api.contacts.add(request.body);
        drafts.clear(addDraftKey('handle'));
        drafts.clear(addDraftKey('note'));
        void store.list.reload();
        onAdded?.(row.id);
        return;
      }
      case 'contact_request':
      case 'contact_relation': {
        const row = request.kind === 'contact_request'
          ? await api.contacts.decideRequest(request.contactId, request.body)
          : await api.contacts.setRelation(request.contactId, request.body);
        store.putRow(row);
        void store.detail(request.contactId).reload();
        return;
      }
      case 'contact_task': {
        const task = await api.contacts.createTask(request.contactId, request.body);
        store.thread(request.contactId).put({ type: 'task', at: task.createdAt, task });
        for (const field of ['title', 'goal', 'acceptance', 'deadline'] as const) {
          drafts.clear(taskDraftKey(request.contactId, field));
        }
        drafts.clear(contactOpKey(request.contactId, 'task'));
        void store.list.reload();
        return;
      }
      default:
        if (!await transmitNetwork(this.deps, request, onAdded)) {
          await this.transmitTask(request);
        }
    }
  }

  private async transmitTask(request: ActionRequest): Promise<void> {
    const { api, drafts } = this.deps;
    let task: NetworkTaskView;
    switch (request.kind) {
      case 'network_task_decide':
        task = await api.networkTasks.decide(request.taskId, request.body);
        break;
      case 'network_task_deliver':
        task = await api.networkTasks.deliver(request.taskId, request.body);
        drafts.clearIfSent(networkTaskOpKey(request.taskId, 'deliver'), request.body.text);
        break;
      case 'network_task_verdict':
        task = await api.networkTasks.verdict(request.taskId, request.body);
        drafts.clear(networkTaskOpKey(request.taskId, 'verdict'));
        break;
      default:
        throw new Error(`联系人的写操作里没有「${request.kind}」`);
    }
    this.applyTask(task);
  }

  private applyTask(task: NetworkTaskView): void {
    const { store } = this.deps;
    store.thread(task.contactId).put({ type: 'task', at: task.createdAt, task });
    void store.detail(task.contactId).reload();
    void store.list.reload();
  }

  /** 409 带着现在那一条：先换上它，再点就是按新的来。 */
  private onRefused(cause: unknown): void {
    if (!(cause instanceof ConflictError)) {
      return;
    }
    const current: unknown = cause.current;
    if (Value.Check(NetworkTaskViewSchema, current)) {
      this.applyTask(current);
    } else if (Value.Check(ContactRowSchema, current)) {
      this.deps.store.putRow(current);
    } else {
      void this.deps.store.list.reload();
    }
  }
}
