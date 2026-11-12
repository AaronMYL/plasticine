// 聊天里的确认卡（11-12 全量优化第 5 条）：别人问了我的 Plasticine、它拿不准时，卡直接出在那段聊天的最后；
// 草稿能改了再发、能自己回、能不回；首页「等你」那一行只带到这段聊天，不再另出一张一样的卡。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

const DRAFT = '能接。稿子发来后，周五前给你 10 条要点。';

function seed(fake: FakeApi, draft: string | null = DRAFT): void {
  const { contacts, m5b, network, visibility, asks } = fake.control;
  seedContacts({ contacts, inbox: m5b.inbox, network, visibility }, NOW);
  const option = (id: string, label: string) => ({ id, label, description: null, recommended: id === 'send' });
  asks.raise({ id: 'ask_reply_zhou', kind: 'confirm', question: '周可 @zhouke 问你的 Plasticine：能接吗？',
    options: [...(draft === null ? [] : [option('send', '这样回')]), option('self', '我自己回'), option('none', '不回')],
    networkReply: { contactId: 'c_zhouke', groupId: null, questionId: 'q_zhou_1', draft } });
}

async function open(hash: string, setup: (fake: FakeApi) => void = seed, width = 1440) {
  const app = await renderApp({ hash, width, setup });
  await settle();
  return app;
}

function card(): HTMLElement {
  return screen.getByRole('region', { name: '等你确认怎么回周可' });
}

describe('聊天里的确认卡', () => {
  it('卡出在这段聊天的最后，别的聊天里没有；改了草稿再发，发的是改过的那一版', async () => {
    const app = await open('#/messages/c_zhouke');
    const log = screen.getByRole('log', { name: '和周可的聊天记录' });
    expect(log.lastElementChild).toBe(card());
    const answer = vi.spyOn(app.api.asks, 'answer');
    const draft = within(card()).getByRole('textbox', { name: '回复草稿' });
    expect((draft as HTMLTextAreaElement).value).toBe(DRAFT);
    fireEvent.change(draft, { target: { value: '能接，周五前给你。' } });
    fireEvent.click(within(card()).getByRole('button', { name: '这样回' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '等你确认怎么回周可' })).toBeNull());
    expect(answer).toHaveBeenCalledWith('ask_reply_zhou',
      expect.objectContaining({ optionId: 'send', text: '能接，周五前给你。' }));
  });

  it('草稿没改就原样发，不带 text', async () => {
    const app = await open('#/messages/c_zhouke');
    const answer = vi.spyOn(app.api.asks, 'answer');
    fireEvent.click(within(card()).getByRole('button', { name: '这样回' }));
    await waitFor(() => expect(answer).toHaveBeenCalled());
    expect(answer.mock.calls[0]?.[1]).not.toHaveProperty('text');
    expect(answer.mock.calls[0]?.[1]).toMatchObject({ optionId: 'send' });
  });

  it('我自己回：卡收起，光标到下面的输入框；不回：卡收起', async () => {
    const app = await open('#/messages/c_zhouke');
    const answer = vi.spyOn(app.api.asks, 'answer');
    fireEvent.click(within(card()).getByRole('button', { name: '我自己回' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '等你确认怎么回周可' })).toBeNull());
    expect(answer.mock.calls[0]?.[1]).toMatchObject({ optionId: 'self' });
    expect(document.activeElement?.closest('.contact-composer')).not.toBeNull();
  });

  it('没有草稿：只有「我自己回」和「不回」，没有草稿框', async () => {
    await open('#/messages/c_zhouke', (fake) => seed(fake, null));
    expect(within(card()).queryByRole('textbox')).toBeNull();
    expect(within(card()).queryByRole('button', { name: '这样回' })).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: '不回' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '等你确认怎么回周可' })).toBeNull());
  });

  it('别人的聊天里不出这张卡；列表里这一行写着「等你」', async () => {
    await open('#/messages/c_linyi');
    expect(screen.queryByRole('region', { name: /等你确认怎么回/ })).toBeNull();
    const row = within(screen.getByRole('complementary', { name: '消息' })).getByRole('button', { name: /^周可，等你/ });
    expect(within(row).getByText('等你')).toBeTruthy();
  });

  it('首页「等你」那一行带到这段聊天，手机上也一样', async () => {
    await open('#/today', seed, 390);
    const link = screen.getByRole('link', { name: '去回' });
    expect(link.getAttribute('href')).toBe('#/messages/c_zhouke');
  });
});
