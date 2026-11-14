// 设置 · AI「输入建议」（11-13 预测消息，Aaron 弹框选放在这里；第13批起开关和模型在「对话」分组的同一行）：一个开关管
// 对话和消息里所有输入框，只在这台设备记住；模型不单选就跟续写。

import type { ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

/** 第13批设置 · AI 分组后：「对话」里「输入建议」那一行右边的开关（模型在同一行）。 */
export function ComposePredictSwitch(): ReactNode {
  const { shellPrefs } = useClientState();
  const on = useStore(shellPrefs.store).composePredict;
  return <input type="checkbox" role="switch" aria-label="输入建议" checked={on}
    onChange={(event) => shellPrefs.setComposePredict(event.currentTarget.checked)} />;
}
