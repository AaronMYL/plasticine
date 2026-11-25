import type { ReactNode } from 'react';
import { InfoTip } from '../../shell/info-tip.tsx';

export interface SectionHeadProps {
  title: string;
  id?: string;
  tip?: string | undefined;
  children?: ReactNode;
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
