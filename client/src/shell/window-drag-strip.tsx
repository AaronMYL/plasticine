import type { ReactNode } from 'react';
import { inDesktopApp } from './host.ts';

export function WindowDragStrip(): ReactNode {
  return inDesktopApp() ? <div className="window-drag-strip" aria-hidden="true" /> : null;
}
