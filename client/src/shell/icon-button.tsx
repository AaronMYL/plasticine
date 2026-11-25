import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon, type IconName } from './icons.tsx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: IconName;
  label: string;
  size?: number;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, size = 16, className = '', title, children,
  type = 'button', ...button }: IconButtonProps): ReactNode {
  return <button {...button} type={type} className={`icon-button ${className}`.trim()}
    aria-label={label} data-tip={title ?? label}>
    <Icon name={icon} size={size} />
    {children}
  </button>;
}
