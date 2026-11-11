import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seedMemoryScene } from '../../../src/api/fake/memory-scene-seed.ts';
import { NOW, renderApp } from '../../helpers.tsx';

describe('记忆里的规则和说法冲突（11-11）', () => {
  it('规则按范围筛；点一条看来源和范围，改成所有队友共用', async () => {
    const app = await renderApp({ hash: '#/memory/rules', setup: ({ control }) => {
      seedMemoryScene({ mates: control.mates, soul: control.soul }, NOW);
    } });
    const row = await screen.findByRole('button', { name: /报告里的数字都带来源链接。/ });
    expect(within(row).getByText('只对研究员')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('group', { name: '适用范围' })).getByRole('button', { name: /UI 设计师/ }));
    expect(screen.queryByRole('button', { name: /报告里的数字都带来源链接。/ })).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: '适用范围' })).getByRole('button', { name: /全部/ }));
    fireEvent.click(await screen.findByRole('button', { name: /报告里的数字都带来源链接。/ }));
    const detail = await screen.findByRole('complementary', { name: '这一条' });
    expect(within(detail).getByText('研究员做事时，这条比所有队友共用的规则优先。')).toBeTruthy();
    fireEvent.change(within(detail).getByRole('combobox', { name: '适用范围' }), { target: { value: '' } });
    await waitFor(async () => {
      const line = (await app.api.soul.get()).lines.find((item) => item.text === '报告里的数字都带来源链接。');
      expect(line?.scopeKind).toBe('all');
    });
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
