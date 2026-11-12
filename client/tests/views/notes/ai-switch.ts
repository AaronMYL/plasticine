// 笔记 AI 下拉里的两个开关（11-12 第 6 条：「续写」「补充建议」从工具栏收进 AI 下拉，开着行尾一个勾）。

import { fireEvent, screen } from '@testing-library/react';

type AiSwitch = '续写' | '补充建议';

function item(name: AiSwitch): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'AI 写作' }));
  return screen.getAllByRole('menuitemcheckbox')
    .find((element) => element.textContent?.startsWith(name)) as HTMLElement;
}

/** 拨一下这个开关。 */
export function toggleAi(name: AiSwitch): void {
  fireEvent.click(item(name));
}

/** 这个开关现在开着没有（看完把菜单收起）。 */
export function aiOn(name: AiSwitch): boolean {
  const element = item(name);
  const on = element.getAttribute('aria-checked') === 'true';
  fireEvent.keyDown(element, { key: 'Escape' });
  return on;
}
