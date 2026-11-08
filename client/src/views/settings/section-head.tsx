// 设置的段头（2026-11-04 第 2 批，用户定「设置页每段说明句：要么常显（必要），要么收起来」）。11-04 重做悬停：
// 收起来的说明放在标题后面的 ⓘ 里（info-tip.tsx：悬停 / 聚焦 / 点了出，读屏经 aria-description 念到），
// 不再整个段头一块浮框。

import type { ReactNode } from 'react';
import { InfoTip } from '../../shell/info-tip.tsx';

export interface SectionHeadProps {
  title: string;
  /** 段标题的 id（section 用 aria-labelledby 指它）。 */
  id?: string;
  /** 这一段的补充说明；不给就没有 ⓘ。 */
  tip?: string | undefined;
  /** 段头右边的东西（按钮、数）。 */
  children?: ReactNode;
  /** 标题级别：设置的段是 h3；「系统」里原系统页的段是 h2。 */
  level?: 2 | 3;
}

export function SectionHead({ title, id, tip, children, level = 3 }: SectionHeadProps): ReactNode {
  const explained = tip !== undefined && tip !== '';
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <header className="block-head">
      <Heading id={id} className="block-title">{title}</Heading>
      {explained ? <InfoTip label={`${title}的说明`} text={tip} /> : null}
      {children}
    </header>
  );
}
