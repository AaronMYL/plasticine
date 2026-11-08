// 假的跨用户任务（第 113 条，规格第 9 节）：对方发来的任务我表态（让 Plasticine 做 / 我来做 / 先不）、我来做的交付、
// 我发出去的被交付后验收（通过 / 退回 + 一句）。状态机不许的是 409，版本旧了是带现在那一条的 ConflictError；
// 按 requestId 幂等。任务本身存在假联系人里，变了由它推 contact.item 和 contacts.changed。
// 本地开发时「让 Plasticine 做」过一会儿就交付（replyMs > 0）。

import type {
  DecideNetworkTaskRequest,
  DeliverNetworkTaskRequest,
  NetworkTasksApi,
  NetworkTaskVersionRequest,
  VerdictNetworkTaskRequest,
} from '../contacts-client.ts';
import { ApiError, ConflictError } from '../errors.ts';
import type { LineMessageView, NetworkTaskView } from '../shared.ts';
import { nextTask, type FakeContacts } from './fake-contacts.ts';
import type { FakeLines } from './fake-lines.ts';
import type { FakeSession } from './fake-session.ts';
import type { FakeReceipts } from './receipts.ts';

export interface FakeNetworkTasksDeps {
  session: FakeSession;
  receipts: FakeReceipts;
  contacts: FakeContacts;
  lines: FakeLines;
  now: () => Date;
}

function notAllowed(message: string): ApiError {
  return new ApiError({ kind: 'failed', code: 'command_not_allowed', message, status: 409 });
}

function content(role: 'user' | 'assistant', text: string, at: string): Omit<LineMessageView, 'lineId' | 'seq'> {
  return { role, text, origin: role === 'user' ? { kind: 'network' } : null,
    thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null,
    ok: null, summary: null, stopReason: role === 'assistant' ? 'stop' : null, childLineId: null,
    attachments: [], widgets: [], createdAt: at };
}

export class FakeNetworkTasks implements NetworkTasksApi {
  private readonly deps: FakeNetworkTasksDeps;

  constructor(deps: FakeNetworkTasksDeps) {
    this.deps = deps;
  }

  async get(id: string): Promise<NetworkTaskView> {
    this.deps.session.require();
    return this.deps.contacts.task(id);
  }

  async decide(id: string, input: DecideNetworkTaskRequest): Promise<NetworkTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/network-tasks/${id}/decide`, () => {
      const task = this.current(id, input.version);
      if (task.direction !== 'in' || task.state !== 'offered') {
        throw notAllowed('这条任务已经表过态了。');
      }
      const now = this.deps.now();
      let next: NetworkTaskView;
      if (input.decision === 'decline') {
        next = nextTask(task, { state: 'declined' }, now);
      } else if (input.decision === 'by_person') {
        next = nextTask(task, { state: 'in_progress', doer: 'person', stage: 2 }, now);
      } else {
        const localTaskId = `task_net_${task.id}`;
        this.deps.lines.put(this.deps.lines.blank(localTaskId, 'background', task.title, {
          status: 'running', activity: '正在处理任务…', activeSince: now.toISOString(),
        }));
        this.deps.lines.record(localTaskId, content('user', task.goal, now.toISOString()), { kind: 'network' });
        next = nextTask(task, { state: 'in_progress', doer: 'ai', stage: 2, localTaskId }, now);
        this.deps.contacts.later(() => this.finishByAi(task.id));
      }
      this.deps.contacts.putTask(next);
      return next;
    });
  }

  async deliver(id: string, input: DeliverNetworkTaskRequest): Promise<NetworkTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/network-tasks/${id}/deliver`, () => {
      const task = this.current(id, input.version);
      if (task.direction !== 'in' || !['accepted', 'in_progress', 'rejected'].includes(task.state)
        || task.doer !== 'person') {
        throw notAllowed('这条任务现在不能交付。');
      }
      const now = this.deps.now();
      const next = nextTask(task, { state: 'delivered', stage: 4, verdict: null, revisionAskId: null,
        delivery: { text: input.text, at: now.toISOString() } }, now);
      this.deps.contacts.putTask(next);
      return next;
    });
  }

  async verdict(id: string, input: VerdictNetworkTaskRequest): Promise<NetworkTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/network-tasks/${id}/verdict`, () => {
      const task = this.current(id, input.version);
      if (task.direction !== 'out' || task.state !== 'delivered') {
        throw notAllowed('这条任务现在不能验收。');
      }
      const now = this.deps.now();
      const passed = input.verdict === 'pass';
      const next = nextTask(task, {
        state: passed ? 'passed' : 'rejected',
        stage: passed ? 5 : 4,
        verdict: { verdict: input.verdict, note: input.note ?? '', at: now.toISOString() },
      }, now);
      this.deps.contacts.putTask(next);
      return next;
    });
  }

  async cancel(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/network-tasks/${id}/cancel`, () => {
      const task = this.current(id, input.version);
      if (task.direction !== 'out' || task.state !== 'offered') {
        throw notAllowed('对方已经点头了，撤不回。');
      }
      const next = nextTask(task, { state: 'cancelled' }, this.deps.now());
      this.deps.contacts.putTask(next);
      return next;
    });
  }

  async stop(id: string, input: NetworkTaskVersionRequest): Promise<NetworkTaskView> {
    this.deps.session.require();
    return this.deps.receipts.run('contacts', input.requestId, `POST /v2/network-tasks/${id}/stop`, () => {
      const task = this.current(id, input.version);
      if (task.direction !== 'in' || task.doer !== 'ai') {
        throw notAllowed('这条任务不是 Plasticine 在做。');
      }
      if (task.localTaskId !== null && this.deps.lines.find(task.localTaskId) !== undefined) {
        this.deps.lines.change(task.localTaskId, { status: 'paused', pauseReason: 'user', outcome: 'stopped',
          activeSince: null, activity: null });
      }
      const next = nextTask(task, { doer: 'person', activity: null, execution: null }, this.deps.now());
      this.deps.contacts.putTask(next);
      return next;
    });
  }

  private current(id: string, version: number): NetworkTaskView {
    const task = this.deps.contacts.task(id);
    if (task.version !== version) {
      throw new ConflictError(task, '这条任务在别处变了，这次没有改。', '看最新的再定。');
    }
    return task;
  }

  /** 本地开发：自己的 Plasticine 做完了，交付回去。 */
  private finishByAi(id: string): void {
    const task = this.deps.contacts.tasks.get(id);
    if (task?.state !== 'in_progress' || task.doer !== 'ai') {
      return;
    }
    const line = task.localTaskId === null ? undefined : this.deps.lines.find(task.localTaskId);
    if (line?.status !== 'running') return;
    const now = this.deps.now();
    const text = `${task.acceptance}（示例交付）`;
    this.deps.lines.record(line.id, content('assistant', text, now.toISOString()));
    this.deps.lines.change(line.id, { status: 'idle', outcome: 'done', activeSince: null,
      activity: null, lastAnswer: text });
    this.deps.contacts.putTask(nextTask(task, { state: 'delivered', stage: 4,
      delivery: { text, at: now.toISOString() } }, now));
  }
}
