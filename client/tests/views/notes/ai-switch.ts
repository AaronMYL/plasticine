// 笔记工具栏上的两个开关（11-12 全量优化第 14 条：「续写」「补充建议」从 AI 下拉放回工具栏外层）。

import { fireEvent, screen } from '@testing-library/react';

type AiSwitch = '续写' | '补充建议';

function control(name: AiSwitch): HTMLInputElement {
  return screen.getAllByRole('switch')
    .find((element) => element.closest('label')?.textContent?.startsWith(name)) as HTMLInputElement;
}

/** 拨一下这个开关。 */
export function toggleAi(name: AiSwitch): void {
  fireEvent.click(control(name));
}

/** 这个开关现在开着没有。 */
export function aiOn(name: AiSwitch): boolean {
  return control(name).checked;
}
