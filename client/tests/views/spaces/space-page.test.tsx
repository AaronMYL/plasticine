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

describe('Web-rendered report', () => {
  it('accepts only valid selection from this space with version, section, and cross-paragraph text', async () => {
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

  it('version history stays openable, old versions read-only, undo independent of toast', async () => {
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
  it('runs in sandboxed allow-scripts iframe with Ask Plasticine to edit, pencil, and menu actions', async () => {
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

  it('Ask Plasticine to edit quotes page into chat and opens compose box', async () => {
    const app = await open(REPORT);
    fireEvent.click(screen.getByRole('button', { name: '让 Plasticine 改' }));
    const quotes = app.state.conversationUi.store.get().quotes;
    expect(quotes.map((quote) => quote.sourceId)).toEqual(['space:sp_cog_1@1']);
    expect(quotes[0]?.text).toContain('改这一页');
  });

  it('inline edit saves returned paragraph as new user version without reloading iframe; Esc closes', async () => {
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

  it('delegates links to host routing internal links and ignoring messages from other iframes', async () => {
    await open(REPORT);
    const page = await frame('认知科学与意识研究周报｜第1期：学会看见，与意识的因果解释');
    window.dispatchEvent(new MessageEvent('message', { data: { pz: 'space', type: 'navigate', hash: '#/today' },
      source: window }));
    expect(window.location.hash).toBe(REPORT);
    fromFrame(page, { type: 'link', kind: 'project', id: 'p-1' });
    await waitFor(() => expect(parseHash(window.location.hash).view).toBe('projects'));
  });
});

describe('Letter view', () => {
  it('header shows Reply and menu (with edit inside); Reply quotes letter into chat', async () => {
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

  it('host streams sandbox-unreadable letter images as bytes and theme once iframe signals ready', async () => {
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

  it('mobile report and letter hide tab bar showing only back button', () => {
    expect(phoneFullPage(parseHash(LETTER))).toBe(true);
    expect(phoneFullPage(parseHash(REPORT))).toBe(true);
    expect(phoneFullPage(parseHash('#/library'))).toBe(false);
  });
});

describe('Legacy layout (pre-web rewrite)', () => {
  it('weekly report renders issue, takeaway, metric cards, charts, right TOC, and read-only sources', async () => {
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

  it('Plasticine edit banner saves Always do this into subscription settings with issue number', async () => {
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

  it('Undo restores previous version and collapses banner', async () => {
    const app = await open(ISSUE, 1440, true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '撤销' })));
    await waitFor(() => expect(screen.queryByText(/这一期改好了/)).toBeNull());
    expect((await app.api.spaces.get('sp_research_2')).version).toBe(3);
  });

  it('opens space on mobile without right-side TOC', async () => {
    await open(ISSUE, 390);
    expect(screen.queryByRole('navigation', { name: '目录' })).toBeNull();
  });

  it('standalone non-subscription space renders plain text without subscription settings', async () => {
    await renderApp({ hash: '#/books/space/sp_visa', setup: (fake) => fake.control.spaces.seed() });
    await screen.findByRole('heading', { level: 1, name: '马来西亚签证核查' });
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '「马来西亚签证核查」的更多操作' }));
    await screen.findByRole('menuitem', { name: '改名' });
    expect(screen.queryByRole('menuitem', { name: '订阅设置' })).toBeNull();
  });
});
