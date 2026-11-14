// 设置 · AI「输入建议」（11-13 预测消息，Aaron 弹框选放在这里）：一个开关管对话和消息里所有输入框，只在这台设备记住。
// 用哪个模型在上面「各用哪个」里（不单选就跟续写）。

import type { ReactNode } from 'react';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';
import { SectionHead } from './section-head.tsx';

const TIP = '对话和消息的输入框里，按上下文猜你接下来要发的那句，浅色字显示；Tab 或点一下采纳，Esc 收起。不会自动发送。';

export function ComposePredictSection(): ReactNode {
  const { shellPrefs } = useClientState();
  const on = useStore(shellPrefs.store).composePredict;
  return (
    <section className="block" aria-labelledby="settings-compose-predict">
      <SectionHead id="settings-compose-predict" title="输入建议" tip={TIP}>
        <input type="checkbox" role="switch" className="ambient-switch" aria-label="输入建议" checked={on}
          onChange={(event) => shellPrefs.setComposePredict(event.currentTarget.checked)} />
      </SectionHead>
    </section>
  );
}
