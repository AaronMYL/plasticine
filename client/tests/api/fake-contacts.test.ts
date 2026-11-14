// 假联系人照规格第 6、9、10 节的服务端行为做：一张并好的列表（人、邮件、系统来源，Plasticine 通知不在里面）、AI↔AI 收成
// 一项、发一句按 requestId 幂等、邮件回最近一封（干跑只记不发）、系统来源不能发、跨用户任务的状态机、网络账号、对外可见。

import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/api/errors.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import type { LiveEvent } from '../../src/api/types.ts';

const NOW = new Date('2026-11-03T14:30:00+08:00');

function seeded() {
  const fake = createFakeApi({ seed: true, streamStepMs: 0, now: () => NOW });
  const events: LiveEvent[] = [];
  fake.api.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
  return { ...fake, events };
}

describe('假联系人 · 列表与聊天', () => {
  it('列表按最近排，并进邮件（按发件地址）和巡查，不含 Plasticine 通知；带新请求数和等你数', async () => {
    const { api } = seeded();
    const list = await api.contacts.list();
    const names = list.contacts.map((row) => row.name);
    expect(names.slice(0, 4)).toEqual(['林一', '小满', '周可', '阿里云']);
    expect(names).toContain('巡查');
    expect(names).not.toContain('Plasticine');
    const times = list.contacts.map((row) => row.last?.at ?? '');
    expect([...times].sort().reverse()).toEqual(times);
    expect(list.requests).toBe(1);
    expect(list.contacts.find((row) => row.name === '周可')?.waiting).toBe(true);
    const mail = list.contacts.find((row) => row.name === '阿里云');
    expect(mail).toMatchObject({ kind: 'mail', address: 'noreply@aliyun.com', unread: 1, canSend: true });
    expect(list.contacts.find((row) => row.name === '巡查')).toMatchObject({ kind: 'system', canSend: false });
  });

  it('林一的聊天：六条 AI↔AI 收成一项，摘要是最后一条的第一句；任务卡带五段进度；有预测一句', async () => {
    const { api } = seeded();
    const page = await api.contacts.messages('c_linyi', {});
    const exchange = page.items.find((item) => item.type === 'exchange');
    expect(exchange).toMatchObject({ type: 'exchange', count: 6, summary: '对齐了表格格式和退货口径' });
    const task = page.items.find((item) => item.type === 'task' && item.task.state === 'in_progress');
    expect(task).toMatchObject({ task: { stage: 2, doer: 'ai', direction: 'out' } });
    // 11-13：原来的「预测一句」挪到了输入建议的假接口（fake-compose.ts）。
    expect(await api.compose.predict({ kind: 'contact', id: 'c_linyi' }, '好，', () => undefined))
      .toMatchObject({ text: '周四晚上我看第一版' });
  });

  it('发一句：同一个 requestId 重发只记一句；问对方的 Plasticine 标 toAi；推 contact.item 和 contacts.changed', async () => {
    const { api, events } = seeded();
    const input = { requestId: 'req_send_000001', text: '周四见', target: 'ai' as const };
    const first = await api.contacts.send('c_linyi', input);
    const again = await api.contacts.send('c_linyi', input);
    expect(again.id).toBe(first.id);
    expect(first.toAi).toBe(true);
    const page = await api.contacts.messages('c_linyi', {});
    expect(page.items.filter((item) => item.type === 'message' && item.message.text === '周四见')).toHaveLength(1);
    expect(events.some((event) => event.type === 'contact.item' && event.contactId === 'c_linyi')).toBe(true);
    expect(events.some((event) => event.type === 'contacts.changed')).toBe(true);
  });

  it('邮件联系人：发 = 回最近一封，干跑只记不发；系统来源不能发', async () => {
    const { api, control } = seeded();
    const sent = await api.contacts.send('mail:noreply@aliyun.com', { requestId: 'req_mail_000001', text: '收到' });
    expect(sent.author).toBe('me');
    expect(control.m5b.inbox.find('inbox_aliyun_expire')?.replies.at(-1)).toMatchObject({ text: '收到',
      status: 'dry_run' });
    const refused = await api.contacts.send('system:patrol', { requestId: 'req_mail_000002', text: '好' })
      .catch((cause: unknown) => cause);
    expect(refused).toMatchObject({ kind: 'invalid' });
  });

  it('新请求：接受后变成正常联系人，不再算新请求；关系改错版本是冲突', async () => {
    const { api } = seeded();
    await api.contacts.decideRequest('c_xiaoman', { requestId: 'req_req_000001', decision: 'accept' });
    expect((await api.contacts.list()).requests).toBe(0);
    const conflict = await api.contacts.setRelation('c_linyi', { requestId: 'req_rel_000001', version: 99,
      relation: 'friend' }).catch((cause: unknown) => cause);
    expect(conflict).toBeInstanceOf(ConflictError);
  });

  it('核对安全码：清掉「安全码变了」、版本 +1；版本不对是冲突', async () => {
    const { api } = seeded();
    const before = (await api.contacts.get('c_linyi')).contact;
    await expect(api.contacts.confirmSafety('c_linyi', { requestId: 'req-safety-stale', version: before.version + 5 }))
      .rejects.toBeInstanceOf(ConflictError);
    const row = await api.contacts.confirmSafety('c_linyi', { requestId: 'req-safety-ok', version: before.version });
    expect(row.version).toBe(before.version + 1);
    expect((await api.contacts.get('c_linyi')).safetyChanged).toBe(false);
  });

  it('按 @handle 加人：网上有的进「我加了对方」，没有的是 404', async () => {
    const { api } = seeded();
    const row = await api.contacts.add({ requestId: 'req_add_000001', handle: '@yuanye' });
    expect(row).toMatchObject({ name: '袁野', state: 'pending' });
    const missing = await api.contacts.add({ requestId: 'req_add_000002', handle: 'nobody' })
      .catch((cause: unknown) => cause);
    expect(missing).toMatchObject({ kind: 'not_found' });
  });
});

describe('假联系人 · 跨用户任务', () => {
  it('让 Plasticine 做后有同一条可读工作，接手会暂停它，详情不会指向不存在的线', async () => {
    const { api, control } = seeded();
    const offered = await api.networkTasks.get('nt_zhou_interviews');
    const mine = await api.networkTasks.decide(offered.id, { requestId: 'req_dec_ai_01', version: offered.version,
      decision: 'by_ai' });
    expect(mine.localTaskId).not.toBeNull();
    const detail = await api.lines.details(mine.localTaskId!, {});
    expect(detail.request?.text).toContain(offered.goal);
    expect(detail.request?.source).toBeNull();
    const stopped = await api.networkTasks.stop(mine.id, { requestId: 'req_stop_ai_01', version: mine.version });
    expect(stopped.localTaskId).toBe(mine.localTaskId);
    expect(control.lines.find(mine.localTaskId!)?.pauseReason).toBe('user');
  });

  it('我来做 → 交付 → 对方那边；先不 → 结束；表过态再表是 409', async () => {
    const { api } = seeded();
    const offered = await api.networkTasks.get('nt_zhou_interviews');
    const mine = await api.networkTasks.decide(offered.id, { requestId: 'req_dec_000001', version: offered.version,
      decision: 'by_person' });
    expect(mine).toMatchObject({ state: 'in_progress', doer: 'person', waiting: true });
    const delivered = await api.networkTasks.deliver(mine.id, { requestId: 'req_dlv_000001', version: mine.version,
      text: '10 条要点' });
    expect(delivered).toMatchObject({ state: 'delivered', stage: 4, waiting: false });
    const again = await api.networkTasks.decide(offered.id, { requestId: 'req_dec_000002',
      version: delivered.version, decision: 'decline' }).catch((cause: unknown) => cause);
    expect(again).toMatchObject({ code: 'command_not_allowed' });
  });

  it('发出去的任务被交付后验收：通过记成交付记录', async () => {
    const { api, control } = seeded();
    const sent = await api.contacts.createTask('c_linyi', { requestId: 'req_tsk_000001', title: '剪一版预告',
      goal: '30 秒', acceptance: '一个视频' });
    const task = control.contacts.task(sent.id);
    control.contacts.putTask({ ...task, state: 'delivered', stage: 4, waiting: true, version: task.version + 1,
      delivery: { text: '剪好了', at: NOW.toISOString() } });
    const passed = await api.networkTasks.verdict(sent.id, { requestId: 'req_vrd_000001', version: task.version + 1,
      verdict: 'pass', note: '好' });
    expect(passed).toMatchObject({ state: 'passed', stage: 5 });
    const detail = await api.contacts.get('c_linyi');
    expect(detail.deliveries[0]).toMatchObject({ taskId: sent.id, state: 'passed' });
  });
});

describe('假网络账号与对外可见', () => {
  it('没加入时第一个免邀请码；加入后生成邀请码和一句能发给朋友的话', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    fake.control.session.signInForDevelopment('测试机');
    expect((await fake.api.network.status()).joined).toBe(false);
    await fake.api.network.join({ requestId: 'req_join_00001', handle: 'alex', displayName: 'Alex' });
    const { invite, shareText } = await fake.api.network.createInvite({ requestId: 'req_inv_000001' });
    expect(shareText).toContain(invite.code);
    expect(await fake.api.network.invites()).toHaveLength(1);
  });

  it('矩阵：三类联系人的人数、三处建议；定一档清掉建议，全部确认把建议变成档位', async () => {
    const { api } = seeded();
    const matrix = await api.visibility.get();
    expect(matrix.pending).toBe(3);
    expect(matrix.relations.map((row) => row.relation)).toEqual(['stranger', 'partner', 'friend']);
    const reading = matrix.materials.find((row) => row.id === 'mt_reading');
    const marked = await api.visibility.mark({ requestId: 'req_mark_00001', kind: 'memory_topic', id: 'mt_reading',
      tier: 'partner', version: reading?.version ?? 0 });
    expect(marked.pending).toBe(2);
    const confirmed = await api.visibility.confirm({ requestId: 'req_conf_00001' });
    expect(confirmed.pending).toBe(0);
    expect(confirmed.materials.find((row) => row.id === 'p_cyber_hunter')?.tier).toBe('public');
  });
});
