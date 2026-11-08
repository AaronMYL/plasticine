// 工具组几页和站内信上的写操作（站内信只剩「设置 · 通知记录」标已读；回复、全部标已读、核实回复第 113 条随站内信页
// 去掉，邮件改在联系人里回）：标识和整个请求体存在 state/action-ops（回执丢了、401、切页、刷新之后原样重发，没了结时
// 同一处不让给出新内容）；表单的字在 inline-drafts（按 key 存 sessionStorage），拿到结果才清。409 带着现在那一条的先换上它。
// 浏览器的动作说不清做没做（result_unknown）算待核实，同一个标识留着，等你在画面上看过说做成了没有。

import type { PlasticineApi } from '../../api/client.ts';
import { ConflictError } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type {
  BrowserActionInput,
  FileEntryView,
  InboxRowView,
  MoneyEntryView,
  TrashEntryView,
  EditMoneyRequest, AddMoneyAccountRequest,
  WriteFileTextRequest,
} from '../../api/shared.ts';
import type { ActionOps, ActionRequest } from '../../state/action-ops.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import { fromTimeInput } from '../../primitives/message/states.ts';
import {
  BROWSER_ACT_OP_KEY,
  BROWSER_OPEN_OP_KEY,
  filesOpKey,
  inboxOpKey,
  MONEY_ADD_OP_KEY,
  moneyEntryOpKey,
} from '../../state/m5b-action-requests.ts';
import type { M5bStores } from './m5b-stores.ts';

export interface M5bActionsDeps {
  api: PlasticineApi;
  stores: M5bStores;
  ops: ActionOps;
  drafts: InlineDrafts;
}

/** `28.5` / `28.50` / `28` 元 → 整数分；不是正的金额就是 null（plasticine-code：金额用整数分）。 */
export function centsOf(text: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

export function moneyDraftKey(field: 'kind' | 'amount' | 'category' | 'merchant' | 'note'): string {
  return `money:new:${field}`;
}

export const BROWSER_URL_DRAFT = 'browser:url';
export const BROWSER_TYPE_DRAFT = 'browser:type';
export const FOLDER_DRAFT = 'files:new-folder';

function flagPatch(flag: 'read' | 'starred' | 'archived', value: boolean) {
  switch (flag) {
    case 'read':
      return { read: value };
    case 'starred':
      return { starred: value };
    case 'archived':
      return { archived: value };
  }
}

async function base64Of(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  // In slices: String.fromCharCode with a whole 20 MB array would overflow the call stack.
  const SLICE = 0x8000;
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  }
  return btoa(binary);
}

export class M5bActions {
  private readonly deps: M5bActionsDeps;

  constructor(deps: M5bActionsDeps) {
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

  // ---------- 记账 ----------

  async recordMoney(): Promise<void> {
    const { drafts } = this.deps;
    const amountCents = centsOf(drafts.get(moneyDraftKey('amount')));
    if (amountCents === null) {
      return;
    }
    const kind = drafts.get(moneyDraftKey('kind')) === 'income' ? 'income' : 'expense';
    const selected = drafts.get(moneyDraftKey('category'));
    const category = this.deps.stores.money.data.get().value?.categories
      .find((item) => item.id === selected && item.kind === kind)?.id ?? '';
    const merchant = drafts.get(moneyDraftKey('merchant')).trim();
    const note = drafts.get(moneyDraftKey('note')).trim();
    await this.run(MONEY_ADD_OP_KEY, '记一笔', merchant === '' ? '新的一笔' : merchant, (requestId) => ({
      kind: 'money_record',
      body: {
        requestId,
        kind,
        amountCents,
        ...(category === '' ? {} : { categoryId: category }),
        ...(merchant === '' ? {} : { merchant }),
        ...(note === '' ? {} : { note }),
      },
    }));
  }

  async removeMoney(entry: MoneyEntryView): Promise<void> {
    await this.run(moneyEntryOpKey(entry.id, 'remove'), '删这笔', entry.merchant ?? '一笔账', (requestId) => ({
      kind: 'money_remove',
      entryId: entry.id,
      body: { requestId, version: entry.version },
    }));
  }

  editMoney(entryId: string, body: Omit<EditMoneyRequest, 'requestId'>): Promise<boolean> {
    return this.run(moneyEntryOpKey(entryId, 'edit'), '保存这笔账', '一笔账', (requestId) => ({
      kind: 'money_edit', entryId, body: { ...body, requestId },
    }));
  }

  addMoneyAccount(body: Omit<AddMoneyAccountRequest, 'requestId'>): Promise<boolean> {
    return this.run('money:account:add', '加一个账户', body.name, (requestId) => ({
      kind: 'money_account', body: { ...body, requestId },
    }));
  }

  saveFileText(body: Omit<WriteFileTextRequest, 'requestId'>): Promise<boolean> {
    return this.run(`files:text:${body.path}`, '保存文本', body.path, (requestId) => ({
      kind: 'files_text', body: { ...body, requestId },
    }));
  }

  async setInboxFlag(message: InboxRowView, flag: 'read' | 'starred' | 'archived', value: boolean): Promise<void> {
    const actions = { read: 'read', starred: 'star', archived: 'archive' } as const;
    const labels = {
      read: value ? '标已读' : '标未读',
      starred: value ? '收藏' : '取消收藏',
      archived: value ? '归档' : '移出归档',
    };
    await this.run(inboxOpKey(message.id, actions[flag]), labels[flag], message.title, (requestId) => ({
      kind: 'inbox_flags',
      messageId: message.id,
      body: { requestId, version: message.version, ...flagPatch(flag, value) },
    }));
  }

  // ---------- 文件页 ----------

  async upload(directory: string, file: File): Promise<void> {
    const contentBase64 = await base64Of(file);
    await this.run(filesOpKey('upload', `${directory}/${file.name}`), '上传', file.name, (requestId) => ({
      kind: 'files_upload',
      body: { requestId, directory, name: file.name, contentBase64 },
    }));
  }

  async createFolder(directory: string): Promise<void> {
    const name = this.deps.drafts.get(FOLDER_DRAFT).trim();
    if (name === '') {
      return;
    }
    const path = directory === '' ? name : `${directory}/${name}`;
    await this.run(filesOpKey('folder', path), '新建文件夹', name, (requestId) => ({
      kind: 'files_folder',
      body: { requestId, path },
    }));
  }

  async move(entry: FileEntryView, to: string, confirmName: string): Promise<boolean> {
    return this.run(filesOpKey('move', entry.path), '改名或移动', entry.name, (requestId) => ({
      kind: 'files_move',
      body: { requestId, from: entry.path, to, confirmName },
    }));
  }

  async trash(entry: FileEntryView, confirmName: string): Promise<boolean> {
    return this.run(filesOpKey('trash', entry.path), '删除（进回收）', entry.name, (requestId) => ({
      kind: 'files_trash',
      body: { requestId, path: entry.path, confirmName },
    }));
  }

  async restore(entry: TrashEntryView): Promise<void> {
    await this.run(filesOpKey('restore', entry.id), '还原', entry.name, (requestId) => ({
      kind: 'files_restore',
      body: { requestId, id: entry.id },
    }));
  }

  // ---------- 成果 ----------

  async openBrowser(): Promise<void> {
    const url = this.deps.drafts.get(BROWSER_URL_DRAFT).trim();
    if (url === '') {
      return;
    }
    await this.run(BROWSER_OPEN_OP_KEY, '打开', url, (requestId) => ({
      kind: 'browser_open',
      body: { requestId, url },
    }));
  }

  async browserAct(action: BrowserActionInput, label: string, tabId: string): Promise<void> {
    await this.run(BROWSER_ACT_OP_KEY, label, '云端浏览器', (requestId) => ({
      kind: 'browser_act',
      body: { requestId, tabId, action },
    }));
  }

  /** 你看过画面：那个说不清的动作做成了没有。之后这个操作了结（没做成的可以再点一次，换新标识）。 */
  async settleBrowser(happened: boolean): Promise<void> {
    const pending = this.deps.ops.get(BROWSER_ACT_OP_KEY);
    if (pending === undefined || pending.request.kind !== 'browser_act') {
      return;
    }
    const actionRequestId = pending.request.body.requestId;
    const key = `browser:settle:${actionRequestId}`;
    const settled = await this.run(key, happened ? '做成了' : '没做成', '云端浏览器', (requestId) => ({
      kind: 'browser_settle',
      actionRequestId,
      body: { requestId, happened },
    }));
    if (settled) {
      this.deps.ops.succeed(BROWSER_ACT_OP_KEY);
    }
  }

  private async run(
    key: string,
    label: string,
    subject: string,
    build: (requestId: string) => ActionRequest,
  ): Promise<boolean> {
    if (this.deps.ops.get(key)?.status === 'failed') {
      this.deps.ops.dismiss(key);
    }
    const request = this.deps.ops.begin(key, label, subject, build, createRequestId);
    return this.perform(key, request);
  }

  private async perform(key: string, request: ActionRequest): Promise<boolean> {
    try {
      await this.send(request);
      this.deps.ops.succeed(key);
      return true;
    } catch (cause) {
      this.deps.ops.fail(key, cause);
      this.onRefused(cause);
      return false;
    }
  }

  private async send(request: ActionRequest): Promise<void> {
    const { api, stores, drafts } = this.deps;
    switch (request.kind) {
      case 'money_record': {
        const entry = await api.money.record(request.body);
        stores.money.apply({ type: 'money.changed', entry });
        for (const field of ['amount', 'merchant', 'note'] as const) {
          drafts.clear(moneyDraftKey(field));
        }
        return;
      }
      case 'money_remove':
      case 'money_edit': {
        const entry = request.kind === 'money_remove'
          ? await api.money.remove(request.entryId, request.body)
          : await api.money.edit(request.entryId, request.body);
        stores.money.apply({ type: 'money.changed', entry });
        return;
      }
      case 'money_account':
        await api.money.addAccount(request.body);
        void stores.money.reload();
        return;
      default:
        await this.sendMore(request);
    }
  }

  private async sendMore(request: ActionRequest): Promise<void> {
    const { api, stores, drafts } = this.deps;
    switch (request.kind) {
      case 'inbox_flags': {
        const { message, unread } = await api.inbox.setFlags(request.messageId, request.body);
        stores.inbox.list.apply({ type: 'inbox.changed', message, unread });
        stores.inbox.message.apply({ type: 'inbox.changed', message, unread });
        stores.inbox.unread.set(unread);
        return;
      }
      default:
        await this.sendFiles(request);
    }
  }

  private async sendFiles(request: ActionRequest): Promise<void> {
    const { api, stores, drafts } = this.deps;
    switch (request.kind) {
      case 'files_upload':
        await api.files.upload(request.body);
        break;
      case 'files_text':
        await api.files.writeText(request.body);
        drafts.clear(`files:text:${request.body.path}:content`);
        drafts.clear(`files:text:${request.body.path}:version`);
        break;
      case 'files_folder':
        await api.files.createFolder(request.body);
        drafts.clear(FOLDER_DRAFT);
        break;
      case 'files_move':
        await api.files.move(request.body);
        break;
      case 'files_trash':
        await api.files.trash(request.body);
        break;
      case 'files_restore':
        await api.files.restore(request.body);
        break;
      default:
        await this.sendBrowser(request);
        return;
    }
    void stores.files.reload();
    void stores.trash.reload();
  }

  private async sendBrowser(request: ActionRequest): Promise<void> {
    const { api, stores, drafts } = this.deps;
    switch (request.kind) {
      case 'browser_open': {
        const browser = await api.browser.open(request.body);
        stores.browser.apply({ type: 'browser.changed', browser });
        drafts.clear(BROWSER_URL_DRAFT);
        return;
      }
      case 'browser_act': {
        const response = await api.browser.act(request.body);
        stores.browser.apply({ type: 'browser.changed', browser: response.browser });
        if (request.body.action.kind === 'type') {
          drafts.clearIfSent(BROWSER_TYPE_DRAFT, request.body.action.text);
        }
        return;
      }
      case 'browser_settle':
        await api.browser.settle(request.actionRequestId, request.body);
        return;
      default:
        return;
    }
  }

  /** A 409 that carries the row as it is now: show that one before the user tries again. */
  private onRefused(cause: unknown): void {
    if (!(cause instanceof ConflictError)) {
      return;
    }
    const current: unknown = cause.current;
    if (typeof current !== 'object' || current === null || !('id' in current)) {
      return;
    }
    void this.deps.stores.money.reload();
    void this.deps.stores.inbox.list.reload();
  }
}
