// 设置弹框里一段的内容（11-13 Aaron 看过设计稿定的六段，见 routes.ts SETTINGS_SECTIONS）：
//   通用 = 外观（含动态背景，11-14 并进来）· 时区 · 通知（第13批加测试通知）· 装到主屏幕（11-13 去掉「提建议或反馈」；
//   11-14 去掉「通知记录」：Aaron 说线上的太长了，只去入口，记录不删）；
//   账号 = 名字、头像、@账号、密码 · 在别的设备上用 · 登录着的设备（11-13 去掉「邀请朋友」，头像并进名字那一行）；
//   AI = 模型（提供商平级）· 同时做几件事 · 技能 · 工具开关；
//   隐私与授权 = 先问你（硬线，第13批从规则页挪来）· 对外可见（只列放开的）· 对外授权 · 自动发出的；
//   浏览器 = 搜索引擎 · 登录着的网站 · 导入 · 网页翻译；
//   系统 = 版本 · 运行情况 · 替你动手的电脑 · 备份（设计稿 Settings-System）。
// 段名是弹框右边的标题，段里每块用自己的小节标题分开，不加说明段落。从别处带着 focus 打开时滚到那一块并把焦点给它。

import { useEffect, useRef, type ReactNode } from 'react';
import type { SettingsFocus } from '../../shell/panel.ts';
import type { SettingsSection } from '../../shell/routes.ts';
import { AccountProfile } from './account-profile.tsx';
import { AccessSection } from './access-section.tsx';
import { HardLinesSection } from './hard-lines-section.tsx';
import { NotificationSection } from './notification-section.tsx';
import { AppearanceSection } from './appearance-section.tsx';
import { BrowserSection } from './browser-section.tsx';
import { Devices } from './devices-block.tsx';
import { InstallSection } from './install-section.tsx';
import { ModelsSection } from '../models/models-section.tsx';
import { SearchEngineSection } from './search-engine-section.tsx';
import { SystemSection } from './system-section.tsx';
import { TimeZoneSection } from './time-zone-section.tsx';
import { TranslateSettingsSection } from './translate-settings-section.tsx';
import { VisibilitySection } from './visibility-section.tsx';
import { OutboundSettings } from './outbound-settings.tsx';
import './settings.css';
import './network.css';

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsSection, string>> = {
  general: '通用',
  account: '账号',
  ai: 'AI',
  grants: '隐私与授权',
  browser: '浏览器',
  system: '系统',
};

/** 两段要整宽：系统（设计稿 Settings-System）、AI 的模型两栏（设计稿 Settings-AI）。 */
const SECTION_CLASS: Partial<Record<SettingsSection, string>> = {
  system: ' settings-system',
  ai: ' settings-ai',
};

/** 一块能被 focus 定位到的地方（旧地址 #/settings/feed 这类、别处的「去设置」）。 */
function Spot({ name, children }: { name: SettingsFocus; children: ReactNode }): ReactNode {
  return <div className="settings-spot" data-settings-focus={name} tabIndex={-1}>{children}</div>;
}

function Blocks({ section }: { section: SettingsSection }): ReactNode {
  switch (section) {
    case 'general':
      return <>
        <AppearanceSection />
        <Spot name="time-zone"><TimeZoneSection /></Spot>
        <Spot name="notify"><NotificationSection /></Spot>
        <InstallSection />
      </>;
    case 'ai':
      return <ModelsSection />;
    case 'browser':
      return <>
        <SearchEngineSection />
        <BrowserSection />
        <Spot name="translate"><TranslateSettingsSection /></Spot>
      </>;
    case 'account':
      return <>
        <AccountProfile />
        <AccessSection />
        <Devices />
      </>;
    case 'system':
      return <SystemSection />;
    case 'grants':
      return <>
        <HardLinesSection />
        <Spot name="visibility"><VisibilitySection /></Spot>
        <OutboundSettings />
      </>;
  }
}

/** 设置弹框右边那一栏：这一段的各块；带 focus 时滚到那一块。 */
export function SettingsBody({ section, focus }: {
  section: SettingsSection;
  focus?: SettingsFocus | undefined;
}): ReactNode {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === undefined || body.current === null) {
      return undefined;
    }
    const root = body.current;
    let focused = false;
    const target = (): boolean => {
      if (!root.isConnected) {
        return false;
      }
      const found = root.querySelector<HTMLElement>(`[data-settings-focus="${focus}"]`);
      if (found === null) {
        return false;
      }
      // 功能模型默认折叠；先展开目标所在的分组，再定位和交给键盘操作。
      const group = found.closest('details');
      if (group !== null) {
        group.open = true;
      }
      if (!focused) {
        found.focus({ preventScroll: true });
        focused = true;
      }
      found.scrollIntoView?.({ block: 'start', behavior: 'auto' });
      return true;
    };
    // 弹框的打开效果先初始化焦点，随后再交给目标，避免父组件的 effect 抢回焦点。
    queueMicrotask(target);
    // 档位读到后才出现字段、上面几块读到后把目标往下推：内容一变就再对准一次，直到你自己动了（滚、点、按键）。
    // 不靠固定延时或轮询。
    const observer = new MutationObserver(() => target());
    observer.observe(root, { childList: true, subtree: true });
    const pane = root.parentElement ?? root;
    const stop = (): void => observer.disconnect();
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const name of events) {
      pane.addEventListener(name, stop, { once: true, passive: true });
    }
    return () => {
      observer.disconnect();
      for (const name of events) {
        pane.removeEventListener(name, stop);
      }
    };
  }, [section, focus]);
  return (
    <div ref={body} className={`settings-content${SECTION_CLASS[section] ?? ''}`}>
      <Blocks section={section} />
    </div>
  );
}
