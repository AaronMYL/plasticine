// 设置 · 通用 · 通知（11-14 设置页一种行，设计稿「设置页的布局」）：「这台设备接收系统通知」一行开关、「发一条测试通知」
// 一行按钮、「通知哪些事」一行「n 类 ›」，点开在下面缩进七类开关（notify-kinds-section.tsx）。
// 用户视角审查 2026-11-01 第 15 条：/v2/push/subscriptions 只回这台设备订没订（PushStatusSchema），没有列所有订阅的
// 接口，所以只写这台的状态，不编台数。通知用来做什么、别的设备去哪看是补充，进 ⓘ。
// 《优化清单》第 12 条（11-06）：通知都是主线上的一条消息，开着的设备再弹一条系统通知；不再发邮件。

import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { NotifyKindsRows } from './notify-kinds-section.tsx';
import { NotifyTest } from './notify-test.tsx';
import type { PushSwitchStatus } from './push-switch.ts';
import { SectionHead } from './section-head.tsx';
import { SettingSwitch } from './setting-row.tsx';

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

/** 开着、能收到时开关本身就说清了；只有收不到、在路上这些才在第二行写一句。 */
const QUIET_STATUSES: readonly PushSwitchStatus[] = ['on', 'native', 'off'];

const TIP = 'Plasticine 的通知都发在和它的对话里；开着这个开关，这台设备再弹一条系统通知，点开回到对应内容。'
  + '其他设备的状态要在那台设备上看。';

export function NotificationSection(): ReactNode {
  const live = useLive();
  const state = useStore(live.push.store);
  const checked = state.status === 'on' || state.status === 'unregistered' || state.status === 'native';
  const disabled = state.status === 'checking' || state.status === 'working'
    || state.status === 'unsupported' || state.status === 'native';
  return (
    <section className="block" aria-labelledby="settings-notify">
      <SectionHead id="settings-notify" title="通知" />
      <SettingSwitch name="这台设备接收系统通知" tip={`${TIP}\n这台设备：${INTERRUPT_TEXT[state.status]}。`}
        checked={checked} disabled={disabled}
        sub={QUIET_STATUSES.includes(state.status) ? undefined : INTERRUPT_TEXT[state.status]}
        onChange={(on) => void (on ? live.push.enable() : live.push.disable())} />
      {state.message === null ? null : (
        <p className="settings-message" role={state.status === 'off' || state.status === 'on' ? 'status' : 'alert'}>
          {state.message}
        </p>
      )}
      {state.status === 'unregistered' ? (
        <div className="set-actions">
          <button type="button" className="secondary-button" onClick={() => void live.push.retry()}>再登记一次</button>
        </div>
      ) : null}
      {checked ? <NotifyTest /> : null}
      <NotifyKindsRows />
    </section>
  );
}
