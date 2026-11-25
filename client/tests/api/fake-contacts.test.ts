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

describe('Mock contacts - list and chat', () => {
  it('List sorts recent, merges mail/patrol, excludes alerts, counts requests/waiting', async () => {
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

  it('Lin Yi chat folds 6 AI-to-AI msgs, shows 5-step task card and predicted line', async () => {
    const { api } = seeded();
    const page = await api.contacts.messages('c_linyi', {});
    const exchange = page.items.find((item) => item.type === 'exchange');
    expect(exchange).toMatchObject({ type: 'exchange', count: 6, summary: '对齐了表格格式和退货口径' });
    const task = page.items.find((item) => item.type === 'task' && item.task.state === 'in_progress');
    expect(task).toMatchObject({ task: { stage: 2, doer: 'ai', direction: 'out' } });
    expect(await api.compose.predict({ kind: 'contact', id: 'c_linyi' }, '好，', () => undefined))
      .toMatchObject({ text: '周四晚上我看第一版' });
  });

  it('Send dedupes requestId, marks toAi, emits contact.item and contacts.changed', async () => {
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

  it('Mail contact replies to latest mail (dry-run logs only); system cannot send', async () => {
    const { api, control } = seeded();
    const sent = await api.contacts.send('mail:noreply@aliyun.com', { requestId: 'req_mail_000001', text: '收到' });
    expect(sent.author).toBe('me');
    expect(control.toolGroups.inbox.find('inbox_aliyun_expire')?.replies.at(-1)).toMatchObject({ text: '收到',
      status: 'dry_run' });
    const refused = await api.contacts.send('system:patrol', { requestId: 'req_mail_000002', text: '好' })
      .catch((cause: unknown) => cause);
    expect(refused).toMatchObject({ kind: 'invalid' });
  });

  it('Accepting request makes normal contact clearing badge; stale relation conflicts', async () => {
    const { api } = seeded();
    await api.contacts.decideRequest('c_xiaoman', { requestId: 'req_req_000001', decision: 'accept' });
    expect((await api.contacts.list()).requests).toBe(0);
    const conflict = await api.contacts.setRelation('c_linyi', { requestId: 'req_rel_000001', version: 99,
      relation: 'friend' }).catch((cause: unknown) => cause);
    expect(conflict).toBeInstanceOf(ConflictError);
  });

  it('Verifying safety number clears changed flag and bumps version; stale conflicts', async () => {
    const { api } = seeded();
    const before = (await api.contacts.get('c_linyi')).contact;
    await expect(api.contacts.confirmSafety('c_linyi', { requestId: 'req-safety-stale', version: before.version + 5 }))
      .rejects.toBeInstanceOf(ConflictError);
    const row = await api.contacts.confirmSafety('c_linyi', { requestId: 'req-safety-ok', version: before.version });
    expect(row.version).toBe(before.version + 1);
    expect((await api.contacts.get('c_linyi')).safetyChanged).toBe(false);
  });

  it('Adding by @handle puts online user in outgoing requests; missing returns 404', async () => {
    const { api } = seeded();
    const row = await api.contacts.add({ requestId: 'req_add_000001', handle: '@yuanye' });
    expect(row).toMatchObject({ name: '袁野', state: 'pending' });
    const missing = await api.contacts.add({ requestId: 'req_add_000002', handle: 'nobody' })
      .catch((cause: unknown) => cause);
    expect(missing).toMatchObject({ kind: 'not_found' });
  });
});

describe('Mock contacts - cross-user tasks', () => {
  it('Assigning Plasticine creates readable work, takeover pauses it, valid line link', async () => {
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

  it('Accept->deliver->peer; decline->end; re-deciding returns 409', async () => {
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

  it('Accepting delivered outbound task records delivery receipt', async () => {
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

describe('Mock network account and external visibility', () => {
  it('First unjoined user skips invite code; joining creates invite code and share text', async () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
    fake.control.session.signInForDevelopment('测试机');
    expect((await fake.api.network.status()).joined).toBe(false);
    await fake.api.network.join({ requestId: 'req_join_00001', handle: 'alex', displayName: 'Alex' });
    const { invite, shareText } = await fake.api.network.createInvite({ requestId: 'req_inv_000001' });
    expect(shareText).toContain(invite.code);
    expect(await fake.api.network.invites()).toHaveLength(1);
  });

  it('Matrix shows 3 contact counts and 3 suggestions; setting tier or confirm clears', async () => {
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
