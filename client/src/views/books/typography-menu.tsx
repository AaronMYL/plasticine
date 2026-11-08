// 「Aa」（第 7 批设计稿 Reader-Aa）：字号五档、行距三档、阅读方式（翻页 / 滚动），都是分段，记在这台设备上
// （reader-prefs.ts）。弹出菜单，挂在顶栏右上角。

import { useRef, type ReactNode } from 'react';
import { Icon } from '../../shell/icons.tsx';
import { useDismiss } from '../../shell/use-dismiss.ts';
import { READING_MODES, TYPE_LEADINGS, TYPE_SIZES, type ReadingMode, type Typography } from './reader-prefs.ts';

export interface TypographyMenuProps {
  value: Typography;
  mode: ReadingMode;
  onChange: (next: Typography) => void;
  onMode: (mode: ReadingMode) => void;
  onClose: () => void;
}

export function TypographyMenu({ value, mode, onChange, onMode, onClose }: TypographyMenuProps): ReactNode {
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<Element | null>(typeof document === 'undefined' ? null : document.querySelector('.bk-aa'));
  // 点外面（「Aa」按钮自己管开关）、Esc、窗口失焦、切页、缩放都收（use-dismiss.ts）。
  useDismiss({ open: true, inside: [menu, toggle], onDismiss: () => onClose() });
  return (
    <div ref={menu} className="bk-type-menu" role="dialog" aria-label="字号与翻页">
      <div className="bk-type-group">
        <span className="bk-type-label">字号</span>
        <div className="segmented" role="group" aria-label="字号">
          {TYPE_SIZES.map((size, index) => (
            <button key={size} type="button" className="segmented-item bk-type-size" aria-pressed={value.size === index}
              onClick={() => onChange({ ...value, size: index })}>{size}</button>
          ))}
        </div>
      </div>
      <div className="bk-type-group">
        <span className="bk-type-label">行距</span>
        <div className="segmented" role="group" aria-label="行距">
          {TYPE_LEADINGS.map((leading, index) => (
            <button key={leading.label} type="button" className="segmented-item" aria-pressed={value.leading === index}
              onClick={() => onChange({ ...value, leading: index })}>{leading.label}</button>
          ))}
        </div>
      </div>
      <div className="bk-type-group">
        <span className="bk-type-label">阅读方式</span>
        <div className="segmented" role="group" aria-label="阅读方式">
          {READING_MODES.map((item) => (
            <button key={item.mode} type="button" className="segmented-item" aria-pressed={mode === item.mode}
              onClick={() => onMode(item.mode)}>
              <Icon name={item.mode === 'paged' ? 'chevron-right' : 'chevron-down'} size={12} />
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
