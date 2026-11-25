import type { ReactNode } from 'react';
import type { Side } from '@floating-ui/react';
import { Icon } from './icons.tsx';

export interface InfoTipProps {
  text: string;
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
