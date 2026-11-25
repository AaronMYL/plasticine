import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp, settle } from '../../helpers.tsx';

function board(): HTMLElement {
  return within(screen.getByRole('main')).getByRole('region', { name: '条目' });
}

function card(title: string): HTMLElement {
  return within(board()).getByRole('listitem', { name: title });
}

function titles(): (string | null)[] {
  return within(board()).queryAllByRole('listitem').map((row) => row.getAttribute('aria-label'));
}

function seed(fake: FakeApi): void {
  fake.control.feed.seedItem({ id: 'f_a', title: '端侧大模型', url: 'https://news.example.com/a', summary: '本地跑。' });
  fake.control.feed.seedItem({ id: 'f_b', title: '同步难题', summary: '联网之后该听谁的？' });
}

describe('feed card footer: Like', () => {
  it('footer orders Like, Save, Discuss, Not Interested, Open Original without showing counts', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const names = within(card('端侧大模型')).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['点赞', '收藏', '讨论', '不感兴趣']);
    expect(within(card('端侧大模型')).getByRole('link', { name: '打开原文' })).toBeTruthy();
    expect(card('端侧大模型').querySelector('.feed-card-actions')?.textContent).toBe('');
  });

  it('clicking Like fills icon and sends like reaction; clicking again removes it', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const like = (): HTMLElement => within(card('端侧大模型')).getByRole('button', { name: '点赞' });
    expect(like().getAttribute('aria-pressed')).toBe('false');
    expect(like().querySelector('path')?.getAttribute('fill')).toBeNull();
    fireEvent.click(like());
    await waitFor(() => expect(like().getAttribute('aria-pressed')).toBe('true'));
    expect(like().querySelector('path')?.getAttribute('fill')).toBe('currentColor');
    expect(app.control.feed.find('f_a')?.reaction).toBe('like');
    fireEvent.click(like());
    await waitFor(() => expect(like().getAttribute('aria-pressed')).toBe('false'));
    expect(app.control.feed.find('f_a')?.reaction).toBeNull();
  });
});

describe('feed card footer: undoable Not Interested', () => {
  it('collapses card into inline Undo placeholder removing card buttons and focusing Undo', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    const before = titles();
    const dislike = within(card('端侧大模型')).getByRole('button', { name: '不感兴趣' });
    dislike.focus();
    fireEvent.click(dislike);
    const undo = await within(card('端侧大模型')).findByRole('button', { name: '撤销' });
    expect(titles()).toEqual(before);
    expect(app.control.feed.find('f_a')?.reaction).toBe('dislike');
    const placeholder = card('端侧大模型');
    expect(placeholder.getAttribute('data-collapsed')).toBe('true');
    expect(within(placeholder).getAllByRole('button')).toEqual([undo]);
    expect(within(placeholder).queryByRole('link')).toBeNull();
    const note = within(placeholder).getByRole('status');
    expect(note.textContent).not.toBe('');
    expect(undo.getAttribute('aria-describedby')).toBe(note.id);
    await waitFor(() => expect(document.activeElement).toBe(undo));
  });

  it('clicking Undo restores card, clears reaction, and returns focus to Not Interested', async () => {
    const app = await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    fireEvent.click(within(card('端侧大模型')).getByRole('button', { name: '不感兴趣' }));
    const undo = await within(card('端侧大模型')).findByRole('button', { name: '撤销' });
    undo.focus();
    fireEvent.click(undo);
    const dislike = await within(card('端侧大模型')).findByRole('button', { name: '不感兴趣' });
    expect(card('端侧大模型').getAttribute('data-collapsed')).toBeNull();
    expect(dislike.getAttribute('aria-pressed')).toBe('false');
    expect(within(card('端侧大模型')).getByText('本地跑。')).toBeTruthy();
    expect(app.control.feed.find('f_a')?.reaction).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(dislike));
  });

  it('placeholder clears after leaving view or switching tabs', async () => {
    await renderApp({ hash: '#/feed', setup: seed });
    await settle();
    fireEvent.click(within(card('端侧大模型')).getByRole('button', { name: '不感兴趣' }));
    await within(card('端侧大模型')).findByRole('button', { name: '撤销' });
    await settle(400);
    expect(titles()).toContain('端侧大模型');
    window.location.hash = '#/today';
    await settle();
    window.location.hash = '#/feed';
    await settle();
    await waitFor(() => expect(titles()).toEqual(['同步难题']));
    fireEvent.click(within(card('同步难题')).getByRole('button', { name: '不感兴趣' }));
    await within(card('同步难题')).findByRole('button', { name: '撤销' });
    const column = screen.getByRole('complementary', { name: '阅读' });
    fireEvent.click(within(column).getByRole('button', { name: /^兴趣/ }));
    await settle();
    fireEvent.click(within(column).getByRole('button', { name: /^信息流/ }));
    await waitFor(() => expect(titles()).toEqual([]));
  });
});
