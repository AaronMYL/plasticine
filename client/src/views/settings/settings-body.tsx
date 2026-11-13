// 设置弹框里一段的内容（11-13 Aaron 看过设计稿定的六段，见 routes.ts SETTINGS_SECTIONS）：
//   通用 = 外观 · 时区 · 通知 · 通知记录 · 装到主屏幕（11-13 去掉「提建议或反馈」，通知记录从账号挪回来）；
//   账号 = 名字、头像、@账号、密码 · 在别的设备上用 · 登录着的设备（11-13 去掉「邀请朋友」，头像并进名字那一行）；
//   AI = 模型（提供商平级）· 同时做几件事 · 技能 · 工具开关；
//   隐私与授权 = 对外可见（只列放开的）· 对外授权 · 自动发出的；
//   浏览器 = 搜索引擎 · 登录着的网站 · 导入 · 网页翻译；
//   系统 = 版本 · 运行情况 · 替你动手的电脑 · 备份（设计稿 Settings-System）。
// 段名是弹框右边的标题，段里每块用自己的小节标题分开，不加说明段落。从别处带着 focus 打开时滚到那一块并把焦点给它。

import { useEffect, useRef, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import type { SettingsFocus } from '../../shell/panel.ts';
import { routeHash, skillsRoute, type SettingsSection } from '../../shell/routes.ts';
import { TOOL_GROUPS_NOTE, ToolGroupsView } from '../tools/tool-groups-view.tsx';
import { AccountProfile } from './account-profile.tsx';
import { AccessSection } from './access-section.tsx';
import { AppearanceSection } from './appearance-section.tsx';
import { BrowserSection } from './browser-section.tsx';
import { Devices } from './devices-block.tsx';
import { InstallSection } from './install-section.tsx';
import { ModelsSection } from '../models/models-section.tsx';
import { NoticesSection } from './notices-section.tsx';
import type { PushSwitchStatus } from './push-switch.ts';
import { SearchEngineSection } from './search-engine-section.tsx';
import { SectionHead } from './section-head.tsx';
import { WorkLimitSection } from './work-limit-section.tsx';
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

/** 通知 ⓘ 里这台设备的说法，按开关状态。 */
const INTERRUPT_TEXT: Readonly<Record<PushSwitchStatus, string>> = {
  checking: '正在看这台设备',
  working: '这台设备正在设置',
  on: '这台设备能收到',
  native: '这台电脑的客户端能收到',
  unregistered: '这台设备订阅了但服务端还没收下',
  off: '这台设备收不到',
  denied: '这台设备收不到（通知被拒绝）',
  unsupported: '这台设备收不到（浏览器不支持）',
};

/** 开着、能收到时开关本身就说清了；只有收不到、在路上这些才常显一句（零、默认不显示）。 */
const QUIET_STATUSES: readonly PushSwitchStatus[] = ['on', 'native', 'off'];

function NotificationSection(): ReactNode {
  const live = useLive();
  const state = useStore(live.push.store);
  const checked = state.status === 'on' || state.status === 'unregistered' || state.status === 'native';
  const disabled = state.status === 'checking' || state.status === 'working'
    || state.status === 'unsupported' || state.status === 'native';
  const toggle = (): void => {
    if (checked) {
      void live.push.disable();
    } else {
      void live.push.enable();
    }
  };
  /*
   * 用户视角审查 2026-11-01 第 15 条：/v2/push/subscriptions 只回这台设备订没订（PushStatusSchema），
   * 没有列所有订阅的接口，所以只写这台的状态，不编台数。通知用来做什么、别的设备去哪看是补充，进段标题后的 ⓘ。
   * 《优化清单》第 12 条（11-06）：通知都是主线上的一条消息，开着的设备再弹一条系统通知；不再发邮件。
   */
  const tip = 'Plasticine 的通知都发在和它的对话里；开着这个开关，这台设备再弹一条系统通知，点开回到对应内容。'
    + '其他设备的状态要在那台设备上看。'
    + `\n这台设备：${INTERRUPT_TEXT[state.status]}。`;
  return (
    <section className="block" aria-labelledby="settings-notify">
      <SectionHead id="settings-notify" title="通知" tip={tip} />
      <label className="settings-switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={toggle} />
        <span>这台设备接收系统通知</span>
      </label>
      {QUIET_STATUSES.includes(state.status) ? null : <p className="block-empty">{INTERRUPT_TEXT[state.status]}</p>}
      {state.message === null ? null : (
        <p className="settings-message" role={state.status === 'off' || state.status === 'on' ? 'status' : 'alert'}>
          {state.message}
        </p>
      )}
      {state.status === 'unregistered' ? (
        <button type="button" className="chip-button settings-retry" onClick={() => void live.push.retry()}>
          再登记一次
        </button>
      ) : null}
    </section>
  );
}

/** 技能 11-13 搬到自己的一页（Plasticine 栏里）；这里留一行入口，去了以后设置弹框自己收起。 */
function SkillsLink(): ReactNode {
  return (
    <section className="block" aria-labelledby="settings-skills">
      <SectionHead id="settings-skills" title="技能">
        <a className="text-button settings-skills-link" href={routeHash(skillsRoute())}>打开技能页</a>
      </SectionHead>
    </section>
  );
}

function ToolSwitches(): ReactNode {
  // 用户视角审查 2026-11-01 已定第 3 条：工具开关从工具组挪到这里。
  return (
    <section className="block" aria-labelledby="settings-tool-groups">
      <SectionHead id="settings-tool-groups" title="工具开关" tip={TOOL_GROUPS_NOTE} />
      <ToolGroupsView note={false} />
    </section>
  );
}

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
        <NotificationSection />
        <Spot name="notices"><NoticesSection /></Spot>
        <InstallSection />
      </>;
    case 'ai':
      return <>
        <ModelsSection />
        <WorkLimitSection />
        <SkillsLink />
        <ToolSwitches />
      </>;
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
