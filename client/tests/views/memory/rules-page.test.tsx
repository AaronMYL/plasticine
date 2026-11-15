import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedMemoryScene } from '../../../src/api/fake/memory-scene-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

describe('规则搬家（第13批）和说法冲突（11-11）', () => {
  it('规则搬家（第13批）：按建议的去处分组、建议搬的默认勾上；改去处、取消一条，搬过去的进各自的 Soul 和「关于你」',
    async () => {
      const app = await renderApp({ hash: '#/memory/rules', setup: ({ control }) => {
        control.memoryTopics.seed();
        seedMemoryScene({ mates: control.mates, soul: control.soul }, NOW);
      } });
      expect(await screen.findByRole('heading', { level: 1, name: '规则搬家' })).toBeTruthy();
      const main = await screen.findByRole('region', { name: 'Plasticine 的 Soul' });
      expect(within(main).getByText('能做的直接做；要我定的给选项，推荐的放第一个。')).toBeTruthy();
      const research = screen.getByRole('region', { name: '研究员的 Soul' });
      expect(within(research).getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(true);
      const product = screen.getByRole('region', { name: '隐私与授权' });
      expect((within(product).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
      // 11-15 一直能勾的那几处一个样子：顶上「全选 · 已选 n」（勾了一部分是一道横），底下浮条「已选 n」加主按钮。
      const all = screen.getByRole('checkbox', { name: '全选' }) as HTMLInputElement;
      expect(all.indeterminate).toBe(true);
      const bar = screen.getByRole('group', { name: '勾了的' });
      expect(within(bar).getByText('已选 9')).toBeTruthy();
      fireEvent.click(within(research).getByRole('checkbox', { name: '先列结论，再列依据。' }));
      fireEvent.change(within(main).getByRole('combobox', { name: '「周末不发等我决定的卡。」搬到哪里' }),
        { target: { value: 'about_you' } });
      fireEvent.click(within(bar).getByRole('button', { name: '搬过去 8 条' }));
      expect(await screen.findByText('搬好了 8 条，还有 2 条留在原处。')).toBeTruthy();
      const mate = (await app.api.mates.list()).mates.find((item) => item.name === '研究员')!;
      expect(app.control.souls.textOf(mate.id)).toContain('## 和我相处中形成的判断\n- 报告里的数字都带来源链接。');
      expect(app.control.souls.textOf(mate.id)).not.toContain('先列结论，再列依据。');
      expect(app.control.souls.textOf('main')).toContain('## 说话\n- 直接讲内容，先说结论。');
      const you = await app.api.memoryTopics.get('t_you');
      expect(you.sections.flatMap((section) => section.lines.map((line) => line.text)))
        .toContain('周末不发等我决定的卡。');
      await waitFor(() => expect(screen.getAllByRole('checkbox', { name: /^(?!全选)/ })).toHaveLength(2));
      expect(within(screen.getByRole('group', { name: '勾了的' })).getByText('已选 0')).toBeTruthy();
      fireEvent.click(screen.getByRole('checkbox', { name: '全选' }));
      expect(within(screen.getByRole('group', { name: '勾了的' })).getByText('已选 2')).toBeTruthy();
    });

  it('规则搬完了：这一页只剩一句，记忆首页不再有提示条；搬之前首页顶上是「规则搬家：n 条等你勾」', async () => {
    const app = await renderApp({ hash: '#/memory', setup: ({ control }) => {
      control.memoryTopics.seed();
    } });
    const banner = await screen.findByRole('region', { name: '规则搬家' });
    expect(within(banner).getByText('规则搬家：6 条等你勾。')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '队友' })).toBeNull();
    fireEvent.click(within(banner).getByRole('button', { name: '去勾' }));
    expect(await screen.findByRole('heading', { level: 1, name: '规则搬家' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('checkbox', { name: '以我的名义对外，照已授权的范围做；超出范围先问我。' }));
    fireEvent.click(screen.getByRole('button', { name: '搬过去 6 条' }));
    expect(await screen.findByText(/规则都搬完了/)).toBeTruthy();
    expect(app.control.soul.live()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '回到记忆' }));
    expect(await screen.findByRole('region', { name: '总览' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '规则搬家' })).toBeNull();
  });

  it('说法冲突：标出现在以哪条为准；选了一条，冲突就没了', async () => {
    const app = await renderApp({ hash: '#/memory/conflicts', setup: ({ control }) => {
      seedMemoryScene({ mates: control.mates, soul: control.soul }, NOW);
    } });
    const winner = await screen.findByRole('article', { name: '现在以这条为准：周末照常提醒到期事项。' });
    // 这一行的「关于你」要等目录读回来才有：机器忙的时候晚一拍，等它出来。
    expect(await within(winner).findByText('你说的 · 10-27 · 关于你')).toBeTruthy();
    fireEvent.click(within(winner).getByRole('button', { name: '以这条为准' }));
    expect(await screen.findByText('没有要你选的说法冲突。')).toBeTruthy();
    expect((await app.api.soul.conflicts()).conflicts).toEqual([]);
  });

  it('说法冲突在桌面客户端：页名只在标题栏，页里不留半截「记忆 /」和孤零零的件数', async () => {
    window.plasticineDesktop = { version: '0.9.0', notify: vi.fn(),
      windowChrome: { current: () => ({ trafficLightInset: 96, fullScreen: false }) } };
    const { view: { container } } = await renderApp({ hash: '#/memory/conflicts', setup: ({ control }) => {
      seedMemoryScene({ mates: control.mates, soul: control.soul }, NOW);
    } });
    expect(await screen.findByRole('article', { name: '现在以这条为准：周末照常提醒到期事项。' })).toBeTruthy();
    const title = container.querySelector<HTMLElement>('.titlebar .titlebar-title')!;
    expect(title.textContent).toBe('说法冲突1');
    expect(title.querySelector('.titlebar-count')?.textContent).toBe('1');
    expect(screen.queryByRole('navigation', { name: '位置' })).toBeNull();
    expect(container.querySelector('.conflicts-page .page-head')).toBeNull();
  });

  it('说法冲突在网页版：「记忆 /」、页名和件数照旧在页里', async () => {
    const { view: { container } } = await renderApp({ hash: '#/memory/conflicts', setup: ({ control }) => {
      seedMemoryScene({ mates: control.mates, soul: control.soul }, NOW);
    } });
    expect(await screen.findByRole('navigation', { name: '位置' })).toBeTruthy();
    const head = container.querySelector<HTMLElement>('.conflicts-page .page-head')!;
    expect(within(head).getByRole('heading', { level: 1, name: '说法冲突' })).toBeTruthy();
    expect(head.querySelector('.page-head-status')?.textContent).toBe('1');
  });
});

afterEach(() => {
  delete window.plasticineDesktop;
});
