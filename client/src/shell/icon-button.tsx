import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon, type IconName } from './icons.tsx';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: IconName;
  label: string;
  size?: number;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 纯图标动作保留可访问名称和原生按钮行为；名字（或 title 给的那句）进悬停提示（tooltip.tsx，像浏览器工具栏那样），
 * 不用系统 title：系统提示样式不归我们管、出得慢，还会和悬停提示叠两层。
 */
export function IconButton({ icon, label, size = 16, className = '', title, children,
  type = 'button', ...button }: IconButtonProps): ReactNode {
  return <button {...button} type={type} className={`icon-button ${className}`.trim()}
    aria-label={label} data-tip={title ?? label}>
    <Icon name={icon} size={size} />
    {children}
  </button>;
}
