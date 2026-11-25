import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowDragStrip } from '../../src/shell/window-drag-strip.tsx';

afterEach(() => {
  delete window.plasticineDesktop;
});

describe('window drag strip', () => {
  it('renders in desktop client and omits in web build', () => {
    const web = render(<WindowDragStrip />);
    expect(web.container.querySelector('.window-drag-strip')).toBeNull();
    web.unmount();
    window.plasticineDesktop = { version: '0.2.1', notify: vi.fn() };
    const desktop = render(<WindowDragStrip />);
    expect(desktop.container.querySelector('.window-drag-strip')).not.toBeNull();
  });

  it('sets no-drag on every page root; start page allows dragging only on top strip', () => {
    const base = readFileSync(join(process.cwd(), 'src/shell/base.css'), 'utf8');
    expect(base).toMatch(/html \{\n {2}-webkit-app-region: no-drag;\n\}/);
    const start = readFileSync(join(process.cwd(), '../desktop/src/pages/start.html'), 'utf8');
    expect(start).not.toMatch(/body \{[^}]*app-region/);
    expect(start).toMatch(/\.drag \{[^}]*height: 44px; -webkit-app-region: drag;/);
    expect(start).toContain('<div class="drag" aria-hidden="true"></div>');
  });
});
