import { useEffect, useState } from 'react';
import './object-target.css';

// 到达后留出阅读定位的时间；不循环闪烁，也不让后台刷新反复抢焦点。
const TARGET_HIGHLIGHT_MS = 2400;

export function useObjectTarget(elementId: string | null, ready: boolean): boolean {
  const [highlighted, setHighlighted] = useState(false);
  useEffect(() => {
    if (elementId === null || !ready) { return; }
    const element = document.getElementById(elementId);
    if (element === null) { return; }
    element.scrollIntoView({ block: 'nearest' });
    element.focus({ preventScroll: true });
    setHighlighted(true);
    const timer = setTimeout(() => setHighlighted(false), TARGET_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [elementId, ready]);
  return highlighted;
}
