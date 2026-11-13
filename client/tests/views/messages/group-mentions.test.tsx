// 群里 @（11-13 Aaron 用群聊后提的）：菜单里有群里的人和每个人的 Plasticine；@ 后面接着打字是找；一句能 @ 好几个
// Plasticine（并排小签，发出去并成一个气泡）；别人的 Plasticine 说的话上面写是谁的；我自己 @ 的、它想先给我看的那句出
// 确认卡。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seedNetworkScene } from '../../../src/api/fake/network-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import type { ContactThreadItem } from '../../../src/api/shared.ts';
import { matchMentions, mentionChoices, mentionQuery } from '../../../src/views/contacts/contact-composer.tsx';
import { foldAsks } from '../../../src/views/contacts/thread-items.tsx';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function group(fake: FakeApi): void {
  seedNetworkScene({ contacts: fake.control.contacts, network: fake.control.network }, NOW, 'group');
}

async function open(setup: (fake: FakeApi) => void = group): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const app = await renderApp({ hash: '#/messages/grp-hangzhou', width: 1440, setup });
  await settle();
  return app;
}

function log(): HTMLElement {
  return screen.getByRole('log', { name: '和杭州周末的聊天记录' });
}

describe('@ 到哪儿了', () => {
  it('行首或空白后面的 @ 才算；@ 后面打的字拿来找；隔了空白就不算了', () => {
    expect(mentionQuery('@', 1)).toBe('');
    expect(mentionQuery('好 @小', 4)).toBe('小');
    expect(mentionQuery('a@b', 3)).toBeNull();
    expect(mentionQuery('@小林 好', 5)).toBeNull();
    expect(mentionQuery('没有', 2)).toBeNull();
  });
});

describe('群里 @', () => {
  it('菜单先列群里的人、再列每个人的 Plasticine 和我的；接着打字只留对得上的', async () => {
    await open();
    const input = await screen.findByRole('textbox', { name: '发给杭州周末' }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
    const menu = await screen.findByRole('listbox', { name: '@ 联系人' });
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '小小林', '周周可', '阿阿杰', '小林的 Plasticine', '周可的 Plasticine', '阿杰的 Plasticine', '我的 Plasticine',
    ]);
    fireEvent.change(input, { target: { value: '@周', selectionStart: 2 } });
    expect(within(screen.getByRole('listbox', { name: '@ 联系人' })).getAllByRole('option')
      .map((option) => option.textContent)).toEqual(['周周可', '周可的 Plasticine']);
    fireEvent.click(within(screen.getByRole('listbox', { name: '@ 联系人' })).getByRole('option', { name: '周可' }));
    expect(input.value).toBe('@周可 ');
  });

  it('一句 @ 两个人的 Plasticine：并排两个小签，发出去是一个气泡写着两个 @，两边各回一句', async () => {
    const app = await open();
    const input = await screen.findByRole('textbox', { name: '发给杭州周末' }) as HTMLTextAreaElement;
    for (const name of [/^小林的 Plasticine/, /^阿杰的 Plasticine/]) {
      fireEvent.change(input, { target: { value: '@', selectionStart: 1 } });
      fireEvent.click(within(await screen.findByRole('listbox', { name: '@ 联系人' })).getByRole('option', { name }));
    }
    const asking = screen.getByRole('textbox', { name: '问小林的 Plasticine、阿杰的 Plasticine' });
    expect(input).toBe(asking);
    // 已经挑了的不再列。
    fireEvent.change(asking, { target: { value: '@', selectionStart: 1 } });
    expect(within(screen.getByRole('listbox', { name: '@ 联系人' })).queryByRole('option', { name: /^小林的 Plasticine/ }))
      .toBeNull();
    fireEvent.change(asking, { target: { value: '周日还去吗', selectionStart: 5 } });
    fireEvent.keyDown(asking, { key: 'Enter' });
    const bubble = await within(log()).findByText(/周日还去吗/);
    await waitFor(() => expect(within(log()).getAllByText(/周日还去吗/)).toHaveLength(1));
    expect(bubble.textContent).toContain('小林的 Plasticine');
    expect(bubble.textContent).toContain('阿杰的 Plasticine');
    const page = await app.api.contacts.messages('grp-hangzhou', {});
    const sent = page.items.flatMap((item) => (item.type === 'message' && item.message.text === '周日还去吗'
      ? [item.message.mention?.name] : []));
    expect(sent).toEqual(['小林', '阿杰']);
  });

  it('别人的 Plasticine 说的话上面写是谁的，我的写「我的 Plasticine」；别人说的整句不提前换行', async () => {
    await open();
    const lin = await within(log()).findByText('小林周六下午两点以后有空。');
    expect(lin.closest('.cm-group-line')?.querySelector('.cm-ai-owner')?.textContent).toBe('小林的 Plasticine');
    const mine = within(log()).getByText(/鹤鸣茶社/);
    expect(mine.closest('.cm-group-line')?.querySelector('.cm-ai-owner')?.textContent).toBe('我的 Plasticine');
    // 种子里同一句 @ 了小林和周可的 Plasticine：只画一个气泡。
    expect(within(log()).getAllByText(/周六下午谁有空一起去茶社/)).toHaveLength(1);
  });
});

describe('并成一个气泡', () => {
  const ask = (id: string, name: string, text: string, at: string, author: 'me' | 'them' = 'me'): ContactThreadItem =>
    ({ type: 'message', message: { id, author, text, at, status: 'sent', toAi: true, exchangeId: null, taskId: null,
      mention: { name, self: false }, sender: { accountId: `acct_${author}`, name: author, handle: author, avatar: null,
        self: author === 'me' } } });

  it('紧挨着、同一个人、字一样的几句问 Plasticine 并成第一句；隔久了、字不一样、别人说的不并', () => {
    const folded = foldAsks([
      ask('a', '小林', '谁有空', '2026-11-13T08:00:00.000Z'),
      ask('b', '周可', '谁有空', '2026-11-13T08:00:01.000Z'),
      ask('c', '阿杰', '谁有空', '2026-11-13T08:05:00.000Z'),
      ask('d', '小林', '另一句', '2026-11-13T08:05:01.000Z'),
      ask('e', '周可', '另一句', '2026-11-13T08:05:02.000Z', 'them'),
    ]);
    expect(folded.items.map((item) => (item.type === 'message' ? item.message.id : ''))).toEqual(['a', 'c', 'd', 'e']);
    expect(folded.also.get('a')).toEqual([{ name: '周可', self: false }]);
    expect(folded.also.size).toBe(1);
  });
});

describe('我自己 @ 的确认卡', () => {
  it('卡在群聊最后：只有「这样发」「不发」，能先改字；点了这样发就收起', async () => {
    const app = await open((fake) => {
      group(fake);
      fake.control.asks.raise({ id: 'ask_reply_self', kind: 'confirm', basis: 'inferred',
        question: '你让 Plasticine 在「杭州周末」里回一句：帮我回阿杰',
        options: [{ id: 'send', label: '这样发', description: null, recommended: true },
          { id: 'none', label: '不发', description: null, recommended: false }],
        networkReply: { contactId: null, groupId: 'grp-hangzhou', questionId: 'q_self_1', draft: '茶社我来订。',
          self: true } });
    });
    const answer = vi.spyOn(app.api.asks, 'answer');
    const card = await screen.findByRole('region', { name: '等你确认发不发' });
    expect(within(card).queryByRole('button', { name: '我自己回' })).toBeNull();
    expect(within(card).getByRole('button', { name: '不发' })).toBeTruthy();
    fireEvent.change(within(card).getByRole('textbox', { name: '要发的话' }), { target: { value: '茶社我订，四点。' } });
    fireEvent.click(within(card).getByRole('button', { name: '这样发' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '等你确认发不发' })).toBeNull());
    expect(answer).toHaveBeenCalledWith('ask_reply_self',
      expect.objectContaining({ optionId: 'send', text: '茶社我订，四点。' }));
  });
});

describe('一对一的 @ 菜单照旧', () => {
  it('对方本人、对方的 Plasticine、我的 Plasticine', () => {
    const row = { id: 'c1', kind: 'person', name: '林一' } as Parameters<typeof mentionChoices>[0];
    expect(mentionChoices(row).map((choice) => choice.id)).toEqual(['person', 'theirs', 'mine']);
    expect(matchMentions(mentionChoices(row), '我', []).map((choice) => choice.id)).toEqual(['mine']);
  });
});
