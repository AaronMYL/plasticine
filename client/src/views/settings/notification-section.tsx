import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { PROACTIVE_DOC_ID } from '../../api/shared.ts';
import { MemoryLinkRow } from './memory-link.tsx';
import { NotifyTest } from './notify-test.tsx';
import type { PushSwitchStatus } from './push-switch.ts';
import { SectionHead } from './section-head.tsx';
import { SettingSwitch } from './setting-row.tsx';

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
      <MemoryLinkRow name="通知哪些事" topicId={PROACTIVE_DOC_ID} page="主动告诉你" />
    </section>
  );
}
