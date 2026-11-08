// ⓘ（2026-11-04 用户定「确需补充信息时，优先使用 info 图标搭配 tooltip，而不是始终显示次要文字」）：16px 描边
// info 图标按钮，--fg2、悬停 --fg；放在要补充的那个东西旁边（标题后、数值旁），不包整行。电脑悬停约 500ms 出、
// 键盘聚焦出、点了立刻出；触屏点了出、再点或点别处收（tooltip.tsx 的 TooltipLayer 认 data-tip-tap）。
// 说明一直挂在 aria-description 上，读屏聚焦就念，不必等浮框。

import type { ReactNode } from 'react';
import type { Side } from '@floating-ui/react';
import { Icon } from './icons.tsx';

export interface InfoTipProps {
  /** 补充的那句话。 */
  text: string;
  /** 读屏名字，说清是谁的说明：「「续写建议」的说明」。 */
  label: string;
  side?: Side;
  className?: string;
}

export function InfoTip({ text, label, side, className }: InfoTipProps): ReactNode {
  return (
    <button type="button" className={className === undefined ? 'info-tip' : `info-tip ${className}`}
      aria-label={label} aria-description={text} data-tip={text} data-tip-side={side} data-tip-tap="">
      <Icon name="info" size={16} />
    </button>
  );
}
