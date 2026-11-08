// 二维码（加好友「让对方扫我」、第一次打开「在手机上打开」）：qrcode-generator（MIT，零依赖）编出模块，这里画成
// SVG，前景 --fg、底 --bg，四周留两格静区。读屏念它编的那串地址。

import qrcode from 'qrcode-generator';
import type { ReactNode } from 'react';

/** 静区：标准要 4 格，放在留白够的版面里 2 格就扫得出来（设计稿边距贴着）。 */
const QUIET = 2;

export function qrModules(text: string): boolean[][] {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const count = code.getModuleCount();
  return Array.from({ length: count }, (_, row) => Array.from({ length: count }, (__, col) => code.isDark(row, col)));
}

export function QrCode({ text, size }: { text: string; size: number }): ReactNode {
  const modules = qrModules(text);
  const count = modules.length + QUIET * 2;
  const path = modules.flatMap((cells, row) => cells.flatMap((dark, col) => (dark
    ? [`M${col + QUIET},${row + QUIET}h1v1h-1z`] : []))).join('');
  return (
    <svg className="net-qr" role="img" aria-label={`二维码：${text}`} width={size} height={size}
      viewBox={`0 0 ${count} ${count}`} shapeRendering="crispEdges">
      <rect width={count} height={count} fill="var(--bg)" />
      <path d={path} fill="var(--fg)" />
    </svg>
  );
}
