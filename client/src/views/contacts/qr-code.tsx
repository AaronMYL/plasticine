import qrcode from 'qrcode-generator';
import type { ReactNode } from 'react';

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
      <rect width={count} height={count} fill="var(--qr-paper)" />
      <path d={path} fill="var(--qr-ink)" />
    </svg>
  );
}
