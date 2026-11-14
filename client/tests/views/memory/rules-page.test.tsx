import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
      const bar = screen.getByRole('region', { name: '搬过去' });
      expect(within(bar).getByText('已勾 9 / 10')).toBeTruthy();
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
      await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
      expect(within(screen.getByRole('region', { name: '搬过去' })).getByText('已勾 0 / 2')).toBeTruthy();
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
    expect(within(winner).getByText('你说的 · 10-27 · 关于你')).toBeTruthy();
    fireEvent.click(within(winner).getByRole('button', { name: '以这条为准' }));
    expect(await screen.findByText('没有要你选的说法冲突。')).toBeTruthy();
    expect((await app.api.soul.conflicts()).conflicts).toEqual([]);
  });
});
