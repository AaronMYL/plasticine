// 空间页（《优化清单》第 6 条；第 8 批第 6 条起是整页网页，设计稿 Report / Report-Edit / Letter，11-09 他确认）：
// 报告和来信在沙盒 iframe 里；标题栏「✦ 让 Plasticine 改」把这一页引用进对话；✎ 在页面上改字、自动存、Esc 或「完成」
// 收起；来信是「回信」。还没重写成网页的旧版式照旧显示、只读；Plasticine 改过一期后的「以后都这样 / 撤销」。
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { phoneFullPage } from '../../../src/shell/phone-bar.tsx';
import { parseHash } from '../../../src/shell/routes.ts';
import { SPACE_SANDBOX } from '../../../src/views/spaces/space-frame.tsx';
import { renderApp, setViewportWidth } from '../../helpers.tsx';

const ISSUE = '#/books/space/sp_research_2';
const REPORT = '#/books/space/sp_cog_1';
const LETTER = '#/books/space/sp_letter_dream';

async function open(hash = ISSUE, width = 1440, recent = false) {
  const app = await renderApp({ hash, width, setup: (fake) => {
    fake.control.spaces.seed();
    if (recent) {
      const get = fake.api.spaces.get;
      vi.spyOn(fake.api.spaces, 'get').mockImplementation(async (...args) => ({
        ...await get(...args), updatedAt: new Date().toISOString(),
      }));
    }
  } });
  if (hash === ISSUE) await screen.findByRole('heading', { level: 1, name: /睡眠中的记忆重放/ });
  return app;
}

async function frame(title: string): Promise<HTMLIFrameElement> {
  const found = await screen.findByTitle(title);
  if (!(found instanceof HTMLIFrameElement)) throw new Error('不是 iframe');
  return found;
}

/** 装成 iframe 里的运行时发来的一句。 */
function fromFrame(element: HTMLIFrameElement, data: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { pz: 'space', ...data },
      source: element.contentWindow }));
  });
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  setViewportWidth(1440);
  vi.restoreAllMocks();
});

describe('网页版的报告', () => {
  it('仅接收本空间的有效选区，引用带版本、小节和跨段原文', async () => {
    const app = await open(REPORT);
    const page = await frame('认知科学与意识研究周报｜第1期：学会看见，与意识的因果解释');
    fromFrame(page, { type: 'selection', text: '第一段\n第二段', sectionId: 'intro', paragraph: 2, left: 20, top: 80 });
    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
    expect(app.state.conversationUi.store.get().quotes[0]?.spaceReference).toEqual({ spaceId: 'sp_cog_1', version: 1,
      anchor: { text: '第一段\n第二段', sectionId: 'intro', paragraph: 2 } });
    expect(screen.queryByRole('button', { name: '引用到对话' })).toBeNull();
    fromFrame(page, { type: 'selection', text: '无效', sectionId: null, paragraph: -1, left: 0, top: 0 });
    expect(screen.queryByRole('button', { name: '引用到对话' })).toBeNull();
  });

  it('版本记录一直可打开，旧版只读，撤销入口不依赖短暂提示', async () => {
    const app = await open(REPORT);
    const current = await app.api.spaces.get('sp_cog_1');
    await app.api.spaces.save(current.id, { requestId: 'revision-test', version: 1, html: '<p>第二版正文</p>' });
    fireEvent.click(screen.getByRole('button', { name: `「${current.title}」的更多操作` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '版本记录' }));
    const dialog = await screen.findByRole('dialog', { name: '版本记录' });
    fireEvent.click(await within(dialog).findByRole('button', { name: '查看第 1 版' }));
    await screen.findByRole('button', { name: '回到最新版' });
    expect(screen.queryByRole('button', { name: '改字' })).toBeNull();
    const page = await frame(current.title);
    expect(page.getAttribute('srcdoc')).toContain('学会识别会改变神经表征');
    fireEvent.click(screen.getByRole('button', { name: '回到最新版' }));
    await screen.findByRole('button', { name: '改字' });
    fireEvent.click(screen.getByRole('button', { name: `「${current.title}」的更多操作` }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '版本记录' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销上次修改' }));
    await waitFor(async () => expect((await app.api.spaces.get(current.id)).version).toBe(3));
  });
  it('整页在沙盒 iframe 里（只给 allow-scripts）；标题栏右边是「让 Plasticine 改」、✎、⋯', async () => {
    await open(REPORT);
    const page = await frame('认知科学与意识研究周报｜第1期：学会看见，与意识的因果解释');
    expect(page.getAttribute('sandbox')).toBe(SPACE_SANDBOX);
    expect(page.getAttribute('srcdoc')).toContain('学会识别会改变神经表征');
    expect(page.getAttribute('srcdoc')).toContain("connect-src 'none'");
    expect(screen.getByRole('button', { name: '让 Plasticine 改' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '改字' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button',
      { name: '「认知科学与意识研究周报｜第1期：学会看见，与意识的因果解释」的更多操作' })).toBeTruthy();
  });

  it('「让 Plasticine 改」把这一页引用进对话、打开对话框', async () => {
    const app = await open(REPORT);
    fireEvent.click(screen.getByRole('button', { name: '让 Plasticine 改' }));
    const quotes = app.state.conversationUi.store.get().quotes;
    expect(quotes.map((quote) => quote.sourceId)).toEqual(['space:sp_cog_1@1']);
    expect(quotes[0]?.text).toContain('改这一页');
  });

  it('✎ 改字：iframe 交回一段就存成新的一版（作者是他），iframe 不重载；Esc 收起', async () => {
    const app = await open(REPORT);
    const page = await frame('认知科学与意识研究周报｜第1期：学会看见，与意识的因果解释');
    fireEvent.click(screen.getByRole('button', { name: '改字' }));
    expect(screen.getByRole('button', { name: '改字' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
    const before = page.getAttribute('srcdoc');
    fromFrame(page, { type: 'edited', index: 0, html: '学会识别会改变神经表征，<b>这句我改了</b>。' });
    await waitFor(async () => expect((await app.api.spaces.get('sp_cog_1')).version).toBe(2));
    const saved = await app.api.spaces.get('sp_cog_1');
    expect(saved.author).toBe('user');
    expect(saved.html).toContain('<h1 class="rp-h1">学会识别会改变神经表征，<b>这句我改了</b>。</h1>');
    expect(saved.html).not.toContain('data-e');
    expect(page.getAttribute('srcdoc')).toBe(before);
    fromFrame(page, { type: 'escape' });
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();
    expect(screen.getByRole('button', { name: '改字' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('页面里的链接交给外面：Plasticine 自己的东西走路由；别的 iframe 发来的不认', async () => {
    await open(REPORT);
    const page = await frame('认知科学与意识研究周报｜第1期：学会看见，与意识的因果解释');
    window.dispatchEvent(new MessageEvent('message', { data: { pz: 'space', type: 'navigate', hash: '#/today' },
      source: window }));
    expect(window.location.hash).toBe(REPORT);
    fromFrame(page, { type: 'link', kind: 'project', id: 'p-1' });
    await waitFor(() => expect(parseHash(window.location.hash).view).toBe('projects'));
  });
});

describe('来信', () => {
  it('标题栏是「回信」和 ⋯（改字收在 ⋯ 里）；回信把这封信引用进对话', async () => {
    const app = await open(LETTER);
    const page = await frame('做梦，有了一组数字');
    expect(page.getAttribute('srcdoc')).toContain('lt-title');
    expect(screen.queryByRole('button', { name: '改字' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回信' }));
    expect(app.state.conversationUi.store.get().quotes[0]?.text).toContain('回信：《做梦，有了一组数字》');
    fireEvent.click(screen.getByRole('button', { name: '「做梦，有了一组数字」的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '改字' }));
    expect(screen.getByRole('button', { name: '完成' })).toBeTruthy();
  });

  it('信里的插图沙盒里读不了：页面说准备好了，外面读好插图按字节传进去，深浅色也传一份', async () => {
    const app = await open(LETTER);
    const page = await frame('做梦，有了一组数字');
    expect(page.getAttribute('srcdoc')).toContain('data-pz-asset="/v2/notes/assets/sample-dream.svg"');
    const asset = vi.spyOn(app.api.spaces, 'asset');
    const sent: Record<string, unknown>[] = [];
    vi.spyOn(page.contentWindow as Window, 'postMessage').mockImplementation((data: unknown) => {
      sent.push(data as Record<string, unknown>);
    });
    fromFrame(page, { type: 'ready', wenkai: '', assets: ['/v2/notes/assets/sample-dream.svg'] });
    await waitFor(() => expect(sent.some((message) => message['type'] === 'asset')).toBe(true));
    expect(asset).toHaveBeenCalledWith('/v2/notes/assets/sample-dream.svg', expect.anything());
    expect(sent.find((message) => message['type'] === 'asset')?.['mime']).toBe('image/svg+xml');
    expect(sent[0]?.['type']).toBe('theme');
  });

  it('手机上打开报告和来信不显示底栏，只有返回', () => {
    expect(phoneFullPage(parseHash(LETTER))).toBe(true);
    expect(phoneFullPage(parseHash(REPORT))).toBe(true);
    expect(phoneFullPage(parseHash('#/library'))).toBe(false);
  });
});

describe('旧版式（还没重写成网页）', () => {
  it('一期研究周报：期号日期、结论、一排数字卡、小节、图表带数据来源、右侧目录、出处能点回原文；只读', async () => {
    await open();
    const article = screen.getByRole('article');
    expect(within(article).getByText('第 2 期 · 11月2日–11月8日')).toBeTruthy();
    expect(within(article).getByText('14')).toBeTruthy();
    expect(within(article).getByRole('heading', { level: 2, name: '本周概览' })).toBeTruthy();
    expect(within(article).getByRole('img', { name: '学完后各晚的重放次数与次日回忆正确率' })).toBeTruthy();
    const sources = within(article).getByRole('region', { name: '出处' });
    expect(within(sources).getByRole('link', { name: /颅内记录的记忆重放/ }).getAttribute('href'))
      .toBe('https://example.org/replay');
    const toc = screen.getByRole('navigation', { name: '目录' });
    expect(within(toc).getAllByRole('link').map((link) => link.textContent))
      .toEqual(['本周概览', '重点研究', '方法与局限', '和你有关', '值得继续追踪']);
    expect(screen.queryByRole('button', { name: '改字' })).toBeNull();
    expect(screen.getByRole('button', { name: '让 Plasticine 改' })).toBeTruthy();
  });

  it('Plasticine 改了这一期：页底一条；「以后都这样」写进订阅设置后那条收起，设置里记着第几期加的', async () => {
    const app = await open(ISSUE, 1440, true);
    const toast = screen.getByRole('status', { name: '' });
    expect(toast.textContent).toContain('这一期改好了：图从 4 张减到 1 张');
    await act(async () => fireEvent.click(within(toast).getByRole('button', { name: '以后都这样' })));
    await waitFor(() => expect(screen.queryByText(/这一期改好了/)).toBeNull());
    const sub = await app.api.subscriptions.get('sub_research');
    expect(sub.settings.rules.map((rule) => [rule.text, rule.fromIssue])).toEqual([['每期最多 1 张图', 2]]);
    fireEvent.click(screen.getByRole('button', { name: '「研究周报 · 第 2 期」的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '订阅设置' }));
    const sheet = await screen.findByRole('dialog', { name: '认知与神经科学研究周报' });
    expect(within(sheet).getByText('每期最多 1 张图')).toBeTruthy();
    expect(within(sheet).getByText('第 2 期加的')).toBeTruthy();
  });

  it('「撤销」恢复上一版，那一条收起', async () => {
    const app = await open(ISSUE, 1440, true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '撤销' })));
    await waitFor(() => expect(screen.queryByText(/这一期改好了/)).toBeNull());
    expect((await app.api.spaces.get('sp_research_2')).version).toBe(3);
  });

  it('手机上也能打开空间，没有右侧目录', async () => {
    await open(ISSUE, 390);
    expect(screen.queryByRole('navigation', { name: '目录' })).toBeNull();
  });

  it('一般空间（不是订阅的一期）：只有文字也能读，没有订阅设置', async () => {
    await renderApp({ hash: '#/books/space/sp_visa', setup: (fake) => fake.control.spaces.seed() });
    await screen.findByRole('heading', { level: 1, name: '马来西亚签证核查' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '「马来西亚签证核查」的更多操作' }));
    await screen.findByRole('menuitem', { name: '改名' });
    expect(screen.queryByRole('menuitem', { name: '订阅设置' })).toBeNull();
  });
});
