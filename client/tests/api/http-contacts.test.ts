// 第 113 条：联系人、跨用户任务、网络账号、对外可见的真实现发往规格第 6 节的路径，回答按 shared 的 schema 校验；
// 写操作带 requestId，回执丢了是「结果待核实」；版本旧了的 409 带现在那一条。

import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/api/errors.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import type { ContactRow, NetworkTaskView } from '../../src/api/shared.ts';
import { eventSources, fakeFetch, json } from './http-fixtures.ts';

const AT = '2026-11-03T06:00:00.000Z';

const ROW: ContactRow = {
  id: 'c_lin', kind: 'person', name: '林一', handle: 'linyi', address: null, relation: 'partner', state: 'active',
  last: { text: '样例收到了', at: AT, author: 'their_ai' }, unread: 0, waiting: false, canSend: true, version: 2,
};

const TASK: NetworkTaskView = {
  id: 'nt_1', direction: 'in', contactId: 'c_zhou', title: '整理访谈稿', goal: '整理要点', acceptance: '10 条要点',
  deadline: null, state: 'offered', doer: null, stage: 1, waiting: true, delivery: null, verdict: null,
  localTaskId: null, createdAt: AT, updatedAt: AT, version: 1,
};

function api(...answers: Array<ReturnType<typeof json>>) {
  const { fetch, calls } = fakeFetch(...answers.map((answer) => () => answer));
  return { http: createHttpApi({ fetch, createEventSource: eventSources().create }), calls };
}

describe('联系人的真实现', () => {
  it('点开一封邮件的正文发往 /v2/contacts/:id/mail/:mailId，回答按 shared 的 schema 校验', async () => {
    const body = { id: 'inbox_1', subject: '本周精选', fromName: '周报', fromAddress: 'news@example.test',
      toAddress: null, at: AT, html: '<p>你好</p>', text: '你好', attachments: ['报价.pdf'] };
    const { http, calls } = api(json(200, body), json(200, { ...body, html: 3 }));
    expect((await http.contacts.mailBody('mail:news@example.test', 'inbox_1')).html).toBe('<p>你好</p>');
    await expect(http.contacts.mailBody('mail:news@example.test', 'inbox_1')).rejects.toThrow();
    expect(calls[0]?.url).toBe(`/v2/contacts/${encodeURIComponent('mail:news@example.test')}/mail/inbox_1`);
  });

  it('列表、资料、聊天一页（带 before）、发一句（问对方的 Plasticine）发往 /v2/contacts 下的路径', async () => {
    const message = { id: 'cm_1', author: 'me', text: '能接吗', at: AT, status: 'sent', toAi: true,
      exchangeId: 'ex_1', taskId: null };
    const { http, calls } = api(
      json(200, { contacts: [ROW], requests: 1, waiting: 0, unread: 0 }),
      json(200, { contact: ROW, tierCap: null, deliveries: [], said: [], safetyCode: '12345', safetyChanged: false }),
      json(200, { items: [{ type: 'message', message }], hasMore: false }),
      json(200, { message }),
    );
    expect((await http.contacts.list()).requests).toBe(1);
    expect((await http.contacts.get('c_lin')).safetyCode).toBe('12345');
    expect((await http.contacts.messages('c_lin', { before: AT })).hasMore).toBe(false);
    const sent = await http.contacts.send('c_lin', { requestId: 'req_send_0001', text: '能接吗', target: 'ai' });
    expect(sent.toAi).toBe(true);
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', '/v2/contacts'],
      ['GET', '/v2/contacts/c_lin'],
      ['GET', `/v2/contacts/c_lin/messages?before=${encodeURIComponent(AT)}`],
      ['POST', '/v2/contacts/c_lin/messages'],
    ]);
    expect(calls[3]?.body).toEqual({ requestId: 'req_send_0001', text: '能接吗', target: 'ai' });
  });

  it('加人、处理请求、改关系、标已读、发任务各走自己的路径；改关系版本旧了是带现在那一行的冲突', async () => {
    const { http, calls } = api(
      json(200, { contact: ROW }),
      json(200, { contact: ROW }),
      json(409, { error: '这个联系人在别处改过了。', code: 'version_conflict', current: ROW }),
      json(200, { contact: ROW }),
      json(200, { task: TASK }),
    );
    await http.contacts.add({ requestId: 'req_add_00001', handle: '@linyi' });
    await http.contacts.decideRequest('c_lin', { requestId: 'req_dec_00001', decision: 'accept' });
    const conflict = await http.contacts.setRelation('c_lin', { requestId: 'req_rel_00001', version: 1,
      relation: 'friend' }).catch((cause: unknown) => cause);
    expect(conflict).toBeInstanceOf(ConflictError);
    expect((conflict as ConflictError<ContactRow>).current.version).toBe(2);
    await http.contacts.read('c_lin', { requestId: 'req_read_0001', upTo: AT });
    await http.contacts.createTask('c_lin', { requestId: 'req_task_0001', title: '整理', goal: '要点',
      acceptance: '10 条' });
    expect(calls.map((call) => call.url)).toEqual([
      '/v2/contacts/add', '/v2/contacts/c_lin/request', '/v2/contacts/c_lin/relation', '/v2/contacts/c_lin/read',
      '/v2/contacts/c_lin/tasks',
    ]);
  });

  it('任务表态、交付、验收发往 /v2/network-tasks/:id 下；回执丢了是待核实', async () => {
    const { fetch, calls } = fakeFetch(
      () => json(200, { task: { ...TASK, state: 'in_progress', doer: 'person', stage: 2, version: 2 } }),
      () => json(200, { task: { ...TASK, state: 'delivered', stage: 4, version: 3 } }),
      () => new TypeError('Failed to fetch'),
    );
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    expect((await http.networkTasks.decide('nt_1', { requestId: 'req_dcd_0001', version: 1,
      decision: 'by_person' })).doer).toBe('person');
    expect((await http.networkTasks.deliver('nt_1', { requestId: 'req_dlv_0001', version: 2,
      text: '做好了' })).state).toBe('delivered');
    const lost = await http.networkTasks.verdict('nt_1', { requestId: 'req_vrd_0001', version: 3,
      verdict: 'pass' }).catch((cause: unknown) => cause);
    expect(lost).toMatchObject({ kind: 'uncertain' });
    expect(calls.map((call) => call.url)).toEqual([
      '/v2/network-tasks/nt_1/decide', '/v2/network-tasks/nt_1/deliver', '/v2/network-tasks/nt_1/verdict',
    ]);
  });

  it('网络账号和对外可见：状态、加入、邀请码、矩阵、定档、全部确认', async () => {
    const status = { joined: true, relayUrl: 'https://relay.example', lastSyncAt: AT, lastError: null,
      inviteNeeded: false, account: { id: 'a1', handle: 'alex', displayName: 'Alex', joinedAt: AT } };
    const invite = { code: 'CH-AAAA-BBBB', createdAt: AT, expiresAt: AT, usedBy: null };
    const matrix = { relations: [{ relation: 'stranger', count: 1 }], pending: 0, materials: [] };
    const { http, calls } = api(
      json(200, status), json(200, status), json(200, { invite, shareText: '填这个码' }),
      json(200, { invites: [invite] }), json(200, matrix), json(200, matrix), json(200, matrix),
    );
    expect((await http.network.status()).account?.handle).toBe('alex');
    await http.network.join({ requestId: 'req_join_0001', handle: 'alex', displayName: 'Alex' });
    expect((await http.network.createInvite({ requestId: 'req_inv_00001' })).shareText).toBe('填这个码');
    expect(await http.network.invites()).toHaveLength(1);
    await http.visibility.get();
    await http.visibility.mark({ requestId: 'req_mark_0001', kind: 'note', id: 'n1', tier: 'public', version: 0 });
    await http.visibility.confirm({ requestId: 'req_conf_0001' });
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', '/v2/network'], ['POST', '/v2/network/join'], ['POST', '/v2/network/invites'],
      ['GET', '/v2/network/invites'], ['GET', '/v2/visibility'], ['POST', '/v2/visibility/marks'],
      ['POST', '/v2/visibility/confirm'],
    ]);
  });
});
