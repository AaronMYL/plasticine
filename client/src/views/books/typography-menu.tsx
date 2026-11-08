// 「Aa」：正文字号五档、行距三档，记在这台设备上（reader-prefs.ts）。弹出菜单，挂在顶栏右上角。

import { useRef, type ReactNode } from 'react';
import { useDismiss } from '../../shell/use-dismiss.ts';
import { TYPE_LEADINGS, TYPE_SIZES, type Typography } from './reader-prefs.ts';

export interface TypographyMenuProps {
  value: Typography;
  onChange: (next: Typography) => void;
  onClose: () => void;
}

export function TypographyMenu({ value, onChange, onClose }: TypographyMenuProps): ReactNode {
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<Element | null>(typeof document === 'undefined' ? null : document.querySelector('.bk-aa'));
  // 点外面（「Aa」按钮自己管开关）、Esc、窗口失焦、切页、缩放都收（use-dismiss.ts）。
  useDismiss({ open: true, inside: [menu, toggle], onDismiss: () => onClose() });
  const size = TYPE_SIZES[value.size] ?? TYPE_SIZES[1];
  return (
    <div ref={menu} className="bk-type-menu" role="dialog" aria-label="字号与行距">
      <div className="bk-type-row">
        <span className="text-meta">字号</span>
        <button type="button" className="chip-button" aria-label="字小一点" disabled={value.size === 0}
          onClick={() => onChange({ ...value, size: value.size - 1 })}>A−</button>
        <span className="bk-type-value">{size}</span>
        <button type="button" className="chip-button" aria-label="字大一点" disabled={value.size === TYPE_SIZES.length - 1}
          onClick={() => onChange({ ...value, size: value.size + 1 })}>A+</button>
      </div>
      <div className="bk-type-row">
        <span className="text-meta">行距</span>
        <div className="segmented" role="group" aria-label="行距">
          {TYPE_LEADINGS.map((leading, index) => (
            <button key={leading.label} type="button" className="segmented-item" aria-pressed={value.leading === index}
              onClick={() => onChange({ ...value, leading: index })}>{leading.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
