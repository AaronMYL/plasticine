// 桌面壳注入的全局入口（类型）。界面里不直接用：一律经 shell/host.ts（第 14 条，界面调用壳的接口只有一个）。
// 11-08 整合：Electron 壳（Mac、Windows 共用）挂 window.plasticineDesktop（agent/shared/api/desktop-bridge.ts）；还装着的
// Swift Mac App 挂的是旧名字 window.plasticineMac，只在 host.ts 里认一次，等它被 Electron 版换掉就删。
import type { MacAttachedFile, PlasticineMacBridge } from '../api/shared.ts';
import type { DesktopHelperBridge } from './desktop-helper.ts';

/** 界面认的那座桥：旧 Mac App 的几样是可选的（按版本有无），Electron 壳另有设备助手。 */
export type HostBridge = PlasticineMacBridge & { helper?: DesktopHelperBridge };

declare global {
  interface Window {
    plasticineDesktop?: HostBridge;
    /** 还装着的 Swift Mac App 挂的旧名字：只在 shell/host.ts 里认。 */
    plasticineMac?: HostBridge;
    __plasticineAttachFiles?: (files: MacAttachedFile[]) => Promise<void>;
    __plasticineFocusComposer?: () => void;
    __plasticineNewNote?: () => Promise<void>;
    /** 原生层报网页标签的变化（agent/shared/api/mac-bridge.ts 的 WebTabEvent，进来先校验）。 */
    __plasticineWebTabEvent?: (event: unknown) => void;
    /** 原生菜单的 ⌘F / ⌘P / ⌘Y（键盘在原生网页里时）交给网页界面（web-page-tools.ts 的 WebMenuCommand）。 */
    __plasticineWebMenu?: (command: unknown) => void;
    /** 桌面壳右键「引用到对话」：{ from: 'ui' } 或网页标签里的 { from: 'web', text, url, title }。 */
    __plasticineQuoteSelection?: (command: unknown) => void;
  }
}

export {};
