// 第 109 条第 3 批（真实数据里看出的三处）：项目没有现状就不写。（回来汇报不摆空话那一处 2026-11-05 随回来汇报
// 从首页去掉；服务端照旧不出标 quiet 的句子。）
// （同一原因的任务收成一组 2026-11-04 第 2 批去掉：原因进行上的浮框，任务页不再分区。）

import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, settle } from '../helpers.tsx';

describe('项目没有现状就不写', () => {
  it('列表里不出现「还没有现状」', async () => {
    await renderApp({ hash: '#/projects', setup: (fake) => {
      fake.control.projects.seed({ id: 'p_empty', name: '空项目' });
    } });
    await settle();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /空项目/ }).length).toBeGreaterThan(0));
    expect(screen.queryByText('还没有现状')).toBeNull();
  });
});
