// 项目页（用户 2026-11-01 定：项目取代关切）：侧栏是「项目」不是「关切」；列表常驻的排最后、逾期标出来；点进详情能
// 采纳 Plasticine 提议的健康度；改档案。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STANDING_PROJECT_IDS } from '../../../src/api/shared.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function main(): HTMLElement {
  return screen.getByRole('main');
}

function day(offset: number): string {
  return new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

function seed(fake: FakeApi): void {
  const { projects } = fake.control;
  projects.seed({ id: STANDING_PROJECT_IDS.personal, name: '个人', standing: true });
  projects.seed({ id: 'p_late', name: '资料交接', due: day(-2), health: 'off' });
  projects.seed({
    id: 'p_hunter', name: 'Cyber Hunter', due: day(4), next: '发今天的采访',
    status: { text: '登记 3 / 10', by: 'brain', at: NOW.toISOString() },
    proposedHealth: { value: 'risk', reason: '登记速度跟不上', at: NOW.toISOString() },
    todos: [{ title: '10 个陌生人登记', due: day(3) }],
    brief: { goal: '人和私人 AI 之间的任务平台', constraints: '', rules: '', terms: '' },
  });
}

describe('项目页', () => {
  it('项目在任务栏目里（第二栏「项目」一节），没有「关切」；列表常驻的排最后，逾期写出来', async () => {
    await renderApp({ hash: '#/projects', setup: seed });
    await settle();
    const nav = screen.getByRole('navigation', { name: '栏目' });
    expect(within(nav).getByRole('button', { name: /^任务/ }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).queryByRole('button', { name: /关切/ })).toBeNull();
    const rows = within(main()).getAllByRole('listitem').filter((item) => item.classList.contains('proj-row'));
    expect(rows.map((item) => item.querySelector('.proj-name')?.textContent)).toEqual(['资料交接', 'Cyber Hunter', '个人']);
    expect(rows[0]?.textContent).toContain('逾期 2 天');
    // 2026-11-03《全量界面优化》：「Plasticine 提议」是 ✦。11-04 重做悬停：汇总数和分段控件重复，不再藏在标题悬停里。
    expect(within(rows[1] as HTMLElement).getByRole('img', { name: 'Plasticine 提议' })).toBeTruthy();
    expect(within(main()).getByRole('heading', { level: 1, name: '项目' }).hasAttribute('title')).toBe(false);
  });

});
