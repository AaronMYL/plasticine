// 设置 · 隐私与授权 ·「先问你」（第13批）：记忆里的「规则」搬进各自的 Soul 和「关于你」以后，硬线不再挂在规则页，
// 放在这里只读（规则搬家的提示条写「硬线和授权留在设置里」）——不管有没有把握都先问你的几类事，一行一个、带锁；
// 代码里拦着，这里不能改。

import type { ReactNode } from 'react';
import { HARD_LINES_HEADING, HARD_LINES_NOTE, hardLines } from '../../api/shared.ts';
import { Icon } from '../../shell/icons.tsx';
import { SectionHead } from './section-head.tsx';

export function HardLinesSection(): ReactNode {
  return (
    <section className="block" aria-label={HARD_LINES_HEADING}>
      <SectionHead title={HARD_LINES_HEADING} tip={HARD_LINES_NOTE} />
      <ul className="hard-lines">
        {hardLines().map((line) => (
          <li key={line} className="hard-line"><Icon name="lock" size={14} /><span>{line}</span></li>
        ))}
      </ul>
    </section>
  );
}
