// 空间页（《优化清单》第 6 条，设计稿 Library-Space）：结论大标题、数字卡、正文、带来源的图表、目录、出处；
// Plasticine 改过一期后的「以后都这样 / 撤销」；他直接改、续写。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, setViewportWidth } from '../../helpers.tsx';

const ISSUE = '#/books/space/sp_research_2';

async function open(hash = ISSUE, width = 1440) {
  const app = await renderApp({ hash, width, setup: (fake) => fake.control.spaces.seed() });
  await screen.findByRole('heading', { level: 1, name: /睡眠中的记忆重放/ });
  return app;
}

afterEach(() => {
  setViewportWidth(1440);
  vi.restoreAllMocks();
});

describe('空间页', () => {
  it('一期研究周报：期号日期、结论、一排数字卡、小节、图表带数据来源、右侧目录、出处能点回原文', async () => {
    await open();
    const article = screen.getByRole('article');
    expect(within(article).getByText('第 2 期 · 11月2日–11月8日')).toBeTruthy();
    expect(within(article).getByText('14')).toBeTruthy();
    expect(within(article).getByText('篇和你有关')).toBeTruthy();
    expect(within(article).getByRole('heading', { level: 2, name: '本周概览' })).toBeTruthy();
    expect(within(article).getByText(/重放越多¹/)).toBeTruthy();
    expect(within(article).getByRole('img', { name: '学完后各晚的重放次数与次日回忆正确率' })).toBeTruthy();
    expect(within(article).getByText(/数据：论文表 2（18 人）/)).toBeTruthy();
    const sources = within(article).getByRole('region', { name: '出处' });
    expect(within(sources).getByRole('link', { name: /颅内记录的记忆重放/ }).getAttribute('href'))
      .toBe('https://example.org/replay');
    const toc = screen.getByRole('navigation', { name: '目录' });
    expect(within(toc).getAllByRole('link').map((link) => link.textContent))
      .toEqual(['本周概览', '重点研究', '方法与局限', '和你有关', '值得继续追踪']);
    expect(screen.getByText(/订阅 · 认知与神经科学研究周报/)).toBeTruthy();
  });

  it('Plasticine 改了这一期：页底一条；「以后都这样」写进订阅设置后那条收起，设置里记着第几期加的', async () => {
    const app = await open();
    const toast = screen.getByRole('status', { name: '' });
    expect(toast.textContent).toContain('这一期改好了：图从 4 张减到 1 张');
    await act(async () => fireEvent.click(within(toast).getByRole('button', { name: '以后都这样' })));
    await waitFor(() => expect(screen.queryByText(/这一期改好了/)).toBeNull());
    const sub = await app.api.subscriptions.get('sub_research');
    expect(sub.settings.rules.map((rule) => [rule.text, rule.fromIssue])).toEqual([['每期最多 1 张图', 2]]);
    fireEvent.click(screen.getByRole('button', { name: '订阅设置' }));
    const sheet = await screen.findByRole('dialog', { name: '认知与神经科学研究周报' });
    expect(within(sheet).getByText('每期最多 1 张图')).toBeTruthy();
    expect(within(sheet).getByText('第 2 期加的')).toBeTruthy();
  });

  it('「撤销」恢复上一版，那一条收起', async () => {
    const app = await open();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '撤销' })));
    await waitFor(() => expect(screen.queryByText(/这一期改好了/)).toBeNull());
    expect((await app.api.spaces.get('sp_research_2')).version).toBe(3);
  });

  it('他直接改：改结论和正文、用续写补一句，保存后作者是他、页上是新的', async () => {
    const app = await open();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByRole('textbox', { name: '结论' }), { target: { value: '我自己的结论' } });
    const body = screen.getByRole('textbox', { name: '第 2 块：正文' });
    fireEvent.focus(body);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '续写' })));
    fireEvent.click(await screen.findByRole('button', { name: '采用' }));
    expect((screen.getByRole('textbox', { name: '第 2 块：正文' }) as HTMLTextAreaElement).value)
      .toContain('下一步可以对照无创记录的结果。');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '保存' })));
    await screen.findByRole('heading', { level: 1, name: '我自己的结论' });
    const saved = await app.api.spaces.get('sp_research_2');
    expect(saved.author).toBe('user');
    expect(saved.doc.headline).toBe('我自己的结论');
  });

  it('手机上也能打开空间，没有右侧目录', async () => {
    await open(ISSUE, 390);
    expect(screen.queryByRole('navigation', { name: '目录' })).toBeNull();
  });

  it('一般空间（不是订阅的一期）：只有文字也能读，顶上写「空间」', async () => {
    await renderApp({ hash: '#/books/space/sp_visa', setup: (fake) => fake.control.spaces.seed() });
    await screen.findByRole('heading', { level: 1, name: '马来西亚签证核查' });
    expect(within(screen.getByRole('main')).getByText('空间')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '订阅设置' })).toBeNull();
  });
});
