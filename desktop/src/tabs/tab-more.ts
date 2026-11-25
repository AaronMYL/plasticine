import type { DeviceActionParams } from '../../../agent/shared/api/index.ts';
import { recentDownloads } from '../app/web-session.ts';
import { trustedDrag, trustedHover } from './cdp.ts';
import type { Tab } from './tab-views.ts';

export interface TabMoreDeps {
  tab(tabId: string): Tab;
  present(tab: Tab): void;
  call(tabId: string, op: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export const MORE_TAB_KINDS = ['tab_hover', 'tab_drag', 'tab_downloads', 'tab_dialog'] as const;

export async function runMoreTab(action: DeviceActionParams, deps: TabMoreDeps): Promise<Record<string, unknown>> {
  switch (action.kind) {
    case 'tab_hover': {
      const tab = deps.tab(action.tabId);
      deps.present(tab);
      await trustedHover(tab.view.webContents, action.x, action.y);
      return { tabId: action.tabId };
    }
    case 'tab_drag': {
      const tab = deps.tab(action.tabId);
      deps.present(tab);
      await trustedDrag(tab.view.webContents, { x: action.x, y: action.y }, { x: action.toX, y: action.toY });
      return { tabId: action.tabId };
    }
    case 'tab_downloads':
      return { downloads: recentDownloads() };
    case 'tab_dialog': {
      const armed = await deps.call(action.tabId, 'dialog-arm', { accept: action.accept, text: action.text });
      return { tabId: action.tabId, armed: armed.armed === true, last: armed.last ?? null };
    }
    default:
      throw new Error('这一步不是网页标签的事。');
  }
}
