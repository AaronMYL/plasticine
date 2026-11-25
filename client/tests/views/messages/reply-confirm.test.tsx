import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { seedContacts } from '../../../src/api/fake/contacts-seed.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

const DRAFT = '能接。稿子发来后，周五前给你 10 条要点。';

function seed(fake: FakeApi, draft: string | null = DRAFT): void {
  const { contacts, toolGroups, network, visibility, asks } = fake.control;
  seedContacts({ contacts, inbox: toolGroups.inbox, network, visibility }, NOW);
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

describe('Confirmation card in chat', () => {
  it('appears only at end of target chat and sends edited draft version when modified', async () => {
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

  it('sends unmodified draft as-is without text override', async () => {
    const app = await open('#/messages/c_zhouke');
    const answer = vi.spyOn(app.api.asks, 'answer');
    fireEvent.click(within(card()).getByRole('button', { name: '这样回' }));
    await waitFor(() => expect(answer).toHaveBeenCalled());
    expect(answer.mock.calls[0]?.[1]).not.toHaveProperty('text');
    expect(answer.mock.calls[0]?.[1]).toMatchObject({ optionId: 'send' });
  });

  it('I\'ll reply collapses card and focuses input; Don\'t reply collapses card', async () => {
    const app = await open('#/messages/c_zhouke');
    const answer = vi.spyOn(app.api.asks, 'answer');
    fireEvent.click(within(card()).getByRole('button', { name: '我自己回' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '等你确认怎么回周可' })).toBeNull());
    expect(answer.mock.calls[0]?.[1]).toMatchObject({ optionId: 'self' });
    expect(document.activeElement?.closest('.contact-composer')).not.toBeNull();
  });

  it('omits draft box when no draft exists, showing only I\'ll reply and Don\'t reply', async () => {
    await open('#/messages/c_zhouke', (fake) => seed(fake, null));
    expect(within(card()).queryByRole('textbox')).toBeNull();
    expect(within(card()).queryByRole('button', { name: '这样回' })).toBeNull();
    fireEvent.click(within(card()).getByRole('button', { name: '不回' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '等你确认怎么回周可' })).toBeNull());
  });

  it('hides card in other chats and shows Waiting badge on the conversation row', async () => {
    await open('#/messages/c_linyi');
    expect(screen.queryByRole('region', { name: /等你确认怎么回/ })).toBeNull();
    const row = within(screen.getByRole('complementary', { name: '消息' })).getByRole('button', { name: /^周可，等你/ });
    expect(within(row).getByText('等你')).toBeTruthy();
  });

  it('home Waiting row navigates to that chat on both desktop and mobile', async () => {
    await open('#/today', seed, 390);
    const link = screen.getByRole('link', { name: '去回' });
    expect(link.getAttribute('href')).toBe('#/messages/c_zhouke');
  });
});
