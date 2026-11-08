// 设备邀请沿主区右侧展开，不受居中设置弹窗的宽高约束。Portal 仍属于设置的操作，焦点由顶层 Sheet 管。
import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function DevicePairLayer({ phone, children }: { phone: boolean; children: ReactNode }): ReactNode {
  const [bounds, setBounds] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (phone) { setBounds({}); return; }
    const main = document.querySelector('.shell-main-area');
    if (main === null) return;
    const measure = (): void => {
      const rect = main.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setBounds({ top: rect.top, left: rect.left,
        right: Math.max(0, window.innerWidth - rect.right), bottom: Math.max(0, window.innerHeight - rect.bottom) });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [phone]);
  return createPortal(<div className="device-pair-layer" data-settings-layer="device-pairing" style={bounds}>
    {children}
  </div>, document.body);
}
