// 桌面客户端里没有标题栏的那几页（建账号、登录、连模型）最上面有一条拖窗口的地方；网页版、手机上没有（11-09）。
// 根上的 no-drag 和开始页只拖顶上一条，是为了换页以后窗口不再按上一页的拖动区域截鼠标（Windows 上建账号那页点不动）。

import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WindowDragStrip } from '../../src/shell/window-drag-strip.tsx';

afterEach(() => {
  delete window.plasticineDesktop;
});

describe('拖窗口的那一条', () => {
  it('桌面客户端里画，网页版不画', () => {
    const web = render(<WindowDragStrip />);
    expect(web.container.querySelector('.window-drag-strip')).toBeNull();
    web.unmount();
    window.plasticineDesktop = { version: '0.2.1', notify: vi.fn() };
    const desktop = render(<WindowDragStrip />);
    expect(desktop.container.querySelector('.window-drag-strip')).not.toBeNull();
  });

  it('每一页根上都是 no-drag；开始页只有顶上一条能拖', () => {
    const base = readFileSync(join(process.cwd(), 'src/shell/base.css'), 'utf8');
    expect(base).toMatch(/html \{\n {2}-webkit-app-region: no-drag;\n\}/);
    const start = readFileSync(join(process.cwd(), '../desktop/src/pages/start.html'), 'utf8');
    expect(start).not.toMatch(/body \{[^}]*app-region/);
    expect(start).toMatch(/\.drag \{[^}]*height: 44px; -webkit-app-region: drag;/);
    expect(start).toContain('<div class="drag" aria-hidden="true"></div>');
  });
});
