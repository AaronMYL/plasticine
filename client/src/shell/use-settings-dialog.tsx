// 设置弹框挂在壳上的那一半（2026-11-05 设置从标签页改成居中弹框）：
// - 地址跟着弹框走：开着时地址是 #/settings/<段>（replaceState，不多走一步历史），关了换回当前标签的那一步。
//   所以刷新、壳重来（配对门之后）弹框照样开着；地址本身不进标签（shell.tsx 不让标签记它）。
// - 别处给的设置地址（旧链接 #/settings/<段>、#/device、navigate 过来的）就是开弹框、跳到那一段那一处；底下照旧画当前标签。
// - 开着时走到了别的地址（通知记录里点开一条、顶栏后退、Mac 菜单开新笔记）：弹框收起（有没保存的修改先问）。

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SettingsDialogProps, SettingsRequest } from '../views/settings/settings-dialog.tsx';
import { lazyView } from './lazy-view.ts';
import type { SettingsFocus } from './panel.ts';
import { parseHash, routeHash, type Route, type SettingsSection } from './routes.ts';

const SettingsDialog = lazyView<SettingsDialogProps>(() => import('../views/settings/settings-dialog.tsx'),
  'SettingsDialog');

export interface SettingsDialogHost {
  /** 地址是设置的（这时壳底下画当前标签，不把它记进标签）。 */
  link: Route | null;
  open: (section?: SettingsSection, focus?: SettingsFocus) => void;
  showing: boolean;
  element: ReactNode;
}

export interface SettingsDialogOptions {
  /** 当前的地址解析出来的路由（use-route）。 */
  linked: Route;
  phone: boolean;
  /** 换地址、不多走一步历史（shell.tsx showHash）。 */
  show: (hash: string) => void;
  /** 当前标签此刻的地址：关弹框时换回它。 */
  tabHash: () => string;
  /** 开弹框前收掉别的浮层（主区的 Sheet、手机全屏对话）。 */
  beforeOpen: () => void;
}

function isSettingsHash(hash: string): boolean {
  return parseHash(hash).view === 'settings';
}

export function useSettingsDialog(options: SettingsDialogOptions): SettingsDialogHost {
  const [request, setRequest] = useState<SettingsRequest | null>(null);
  const [leave, setLeave] = useState(0);
  const seq = useRef(0);
  // 弹框自己写进地址的那一个：地址变成它时不当成「别处又要开一次」。
  const written = useRef<string | null>(null);
  const wasLink = useRef(false);
  const link = options.linked.view === 'settings' ? options.linked : null;
  const linkHash = link === null ? null : window.location.hash;

  const open = (section: SettingsSection = 'general', focus?: SettingsFocus): void => {
    options.beforeOpen();
    seq.current += 1;
    setRequest({ section, focus, seq: seq.current });
  };
  useEffect(() => {
    if (link === null || linkHash === written.current) {
      return;
    }
    open(link.settingsSection, link.settingsFocus);
    // 每来一次别处给的设置地址开一次（open 每次渲染都是新的，不进依赖）。
  }, [linkHash]);
  const isLink = link !== null;
  useEffect(() => {
    if (request !== null && wasLink.current && !isLink) {
      setLeave((value) => value + 1);
    }
    if (!isLink) {
      written.current = null;
    }
    wasLink.current = isLink;
  }, [isLink, request]);

  const place = (section: SettingsSection): void => {
    const target = routeHash({ view: 'settings', noteId: null, settingsSection: section });
    if (window.location.hash !== target) {
      written.current = target;
      options.show(target);
    }
  };
  const closed = (): void => {
    setRequest(null);
    if (isSettingsHash(window.location.hash)) {
      options.show(options.tabHash());
    }
  };
  const element = request === null ? null : (
    <Suspense fallback={null}>
      <SettingsDialog request={request} leave={leave} phone={options.phone} onPlace={place} onClosed={closed} />
    </Suspense>
  );
  return { link, open, showing: request !== null, element };
}
