// 联系人里不画界面的那几样：聊天里按身份换一项（任务卡只换更新的、收进 AI↔AI 的单句拿掉、按时间插入）、更早几页和最新
// 一页去重地接起来、任务卡的五段进度和一句状态、列表行尾的时间怎么写（列表的筛选和顺序见 messages/message-filter）。

import { describe, expect, it } from 'vitest';
import type { ContactMessageView, ContactThreadItem, NetworkTaskView } from '../../../src/api/shared.ts';
import { deadlineText, listTime } from '../../../src/views/contacts/contact-time.ts';
import { joinItems, upsertItem } from '../../../src/views/contacts/contacts-store.ts';
import { progressLabel, segments, taskStatusLine } from '../../../src/views/contacts/task-status.ts';

const TZ = 'Asia/Shanghai';

function message(id: string, at: string, fields: Partial<ContactMessageView> = {}): ContactThreadItem {
  return { type: 'message', message: { id, author: 'them', text: id, at, status: 'sent', toAi: false,
    exchangeId: null, taskId: null, ...fields } };
}

function task(fields: Partial<NetworkTaskView> = {}): NetworkTaskView {
  return { id: 'nt_1', direction: 'out', contactId: 'c_1', title: '整理', goal: '要点', acceptance: '10 条',
    deadline: null, state: 'offered', doer: null, stage: 1, waiting: false, delivery: null, verdict: null,
    localTaskId: null, createdAt: '2026-11-03T02:00:00.000Z', updatedAt: '2026-11-03T02:00:00.000Z', version: 1,
    ...fields };
}

describe('聊天里按身份换一项', () => {
  it('新的一句按时间插进去；同一句再来原地换', () => {
    const items = [message('a', '2026-11-03T01:00:00.000Z'), message('c', '2026-11-03T03:00:00.000Z')];
    const inserted = upsertItem(items, message('b', '2026-11-03T02:00:00.000Z'));
    expect(inserted?.map((item) => (item.type === 'message' ? item.message.id : ''))).toEqual(['a', 'b', 'c']);
    const replaced = upsertItem(inserted ?? [], message('b', '2026-11-03T02:00:00.000Z', { text: '改了' }));
    expect(replaced?.[1]).toMatchObject({ message: { text: '改了' } });
  });

  it('任务卡只换版本更新的；旧版本来了不动', () => {
    const items: ContactThreadItem[] = [{ type: 'task', at: task().createdAt, task: task({ version: 3 }) }];
    expect(upsertItem(items, { type: 'task', at: task().createdAt, task: task({ version: 2 }) })).toBeNull();
    expect(upsertItem(items, { type: 'task', at: task().createdAt, task: task({ version: 4, stage: 2 }) })?.[0])
      .toMatchObject({ task: { stage: 2 } });
  });

  it('一段 AI↔AI 收起来之后，里面的单句不再单独摆；之后再来的同一句也不摆', () => {
    const one = message('x1', '2026-11-03T01:00:00.000Z', { author: 'my_ai', exchangeId: 'ex' });
    const two = message('x2', '2026-11-03T01:01:00.000Z', { author: 'their_ai', exchangeId: 'ex' });
    const messages = [one, two].flatMap((item) => (item.type === 'message' ? [item.message] : []));
    const exchange: ContactThreadItem = { type: 'exchange', id: 'ex', at: '2026-11-03T01:00:00.000Z', count: 2,
      summary: 'x2', messages };
    const folded = upsertItem([one], exchange);
    expect(folded?.map((item) => item.type)).toEqual(['exchange']);
    expect(upsertItem(folded ?? [], two)).toBeNull();
  });

  it('更早的几页接在前面，和最新一页重的那几项只留一份', () => {
    const shared = message('b', '2026-11-03T02:00:00.000Z');
    const joined = joinItems([message('a', '2026-11-03T01:00:00.000Z'), shared], [shared,
      message('c', '2026-11-03T03:00:00.000Z')]);
    expect(joined.map((item) => (item.type === 'message' ? item.message.id : ''))).toEqual(['a', 'b', 'c']);
  });
});

describe('任务卡的进度和一句状态', () => {
  it('五段：做完的、正在做的（「在做」那一段亮着，再改改也回到那一段）各自一种', () => {
    expect(segments({ stage: 3, state: 'in_progress' })).toEqual(['done', 'done', 'run', 'off', 'off']);
    expect(segments({ stage: 1, state: 'offered' })).toEqual(['done', 'off', 'off', 'off', 'off']);
    expect(segments({ stage: 3, state: 'rejected' })).toEqual(['done', 'done', 'run', 'off', 'off']);
    expect(segments({ stage: 4, state: 'delivered' })).toEqual(['done', 'done', 'done', 'done', 'off']);
    expect(progressLabel({ stage: 5, state: 'passed' })).toBe('进度：发出 · 点头 · 在做 · 交付 · 收到');
  });

  it('一句状态只说现在谁在干什么；等我表态的那一张不写', () => {
    expect(taskStatusLine(task(), '林一')).toBe('等林一点头');
    expect(taskStatusLine(task({ direction: 'in' }), '周可')).toBe('');
    expect(taskStatusLine(task({ state: 'in_progress', doer: 'ai' }), '林一')).toBe('林一的 Plasticine 在做');
    expect(taskStatusLine(task({ direction: 'in', state: 'in_progress', doer: 'ai' }), '周可'))
      .toBe('你的 Plasticine 在做');
    expect(taskStatusLine(task({ direction: 'in', state: 'delivered' }), '周可')).toBe('等周可验收');
    expect(taskStatusLine(task({ state: 'rejected', verdict: { verdict: 'reject', note: '少两场', at: '' } }), '林一'))
      .toBe('再改改 · 少两场');
  });
});

describe('联系人里的时间', () => {
  const now = new Date('2026-11-03T06:30:00.000Z');

  it('今天写钟点、昨天写「昨天」、一周内写星期、再早写月-日', () => {
    expect(listTime('2026-11-03T06:20:00.000Z', now, TZ)).toBe('14:20');
    expect(listTime('2026-11-02T06:20:00.000Z', now, TZ)).toBe('昨天');
    expect(listTime('2026-10-30T06:20:00.000Z', now, TZ)).toBe('周五');
    expect(listTime('2026-10-20T06:20:00.000Z', now, TZ)).toBe('10-20');
  });

  it('期限一周内写星期和钟点，再远写月-日和钟点', () => {
    expect(deadlineText('2026-11-06T10:00:00.000Z', now, TZ)).toBe('周五 18:00');
    expect(deadlineText('2026-11-16T10:00:00.000Z', now, TZ)).toBe('11-16 18:00');
  });
});
