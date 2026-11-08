// 网页工具条 ⋯ 里的「导入登录…」（第 3 批；11-05 第 6 条起只导登录状态）：跳到设置 · 浏览器并打开导入弹层。跳过去之后设置那一段才挂上，
// 所以先在这里记一笔，那一段挂上时看到就打开、随即清掉。

import { routeHash } from '../../shell/routes.ts';
import { Store } from '../../state/store.ts';

export const loginImportRequested = new Store<boolean>(false);

export function openLoginImport(): void {
  loginImportRequested.set(true);
  window.location.hash = routeHash({ view: 'settings', noteId: null, settingsSection: 'browser' });
}
