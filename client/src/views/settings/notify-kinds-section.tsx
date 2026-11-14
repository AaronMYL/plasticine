// 设置 · 通用 · 通知 ·「通知哪些事」（第13批，11-14 Aaron：「通知消息可以按类型在设置中开关」，看过设计稿弹框都选推荐）：
// 七类各一个开关，所有设备一起生效（存在服务器上）；关掉的那一类只是不弹系统通知，对话和消息里照常有、红点照常亮。
// 「等你的事」关着时开关下面写一句后果。设计稿 NotifyTypes / NotifyTypesPhone；11-14 设置页一种行：收进「n 类 ›」。

import { useState, type ReactNode } from 'react';
import type { NotifyKind } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { SettingRow, ValueButton } from './setting-row.tsx';

const TIP = '所有设备一起生效。关掉的那一类只是不弹系统通知，对话和消息里照常有，红点照常亮。';

const ROWS: readonly { kind: NotifyKind; label: string; tip?: string }[] = [
  { kind: 'ask', label: '等你的事', tip: '要你同意、回答的卡片。' },
  { kind: 'contact', label: '联系人消息' },
  { kind: 'group', label: '群组消息' },
  { kind: 'main', label: '主线回复' },
  { kind: 'mate', label: '队友回复' },
  { kind: 'letter', label: '来信' },
  { kind: 'notice', label: '提醒和结果', tip: '定时任务和心跳的结果、后台没做成的活、服务器磁盘快满。' },
];

/** 「通知哪些事」一行（「n 类 ›」），点开在下面缩进七类开关。 */
export function NotifyKindsRows(): ReactNode {
  const live = useLive();
  const kinds = useStore(live.push.kinds);
  const error = useStore(live.push.kindsError);
  const [open, setOpen] = useState(false);
  const on = ROWS.filter((row) => kinds[row.kind]).length;
  return (
    <>
      <SettingRow name="通知哪些事" tip={TIP}>
        <ValueButton label="通知哪些事" value={on === ROWS.length ? `${on} 类` : `${on} / ${ROWS.length} 类`}
          expanded={open} onClick={() => setOpen(!open)} />
      </SettingRow>
      {open ? (
        <ul className="set-sub notify-kinds-list" aria-label="通知哪些事">
          {ROWS.map((row) => (
            <SettingRow key={row.kind} as="li" name={row.label} tip={row.tip}
              sub={row.kind === 'ask' && !kinds.ask
                ? <span className="set-row-error" role="note">要你同意、回答的事不会弹出来，记得去首页「等你」看。</span>
                : undefined}>
              <input type="checkbox" role="switch" aria-label={row.label} checked={kinds[row.kind]}
                onChange={(event) => void live.push.setKind(row.kind, event.target.checked)} />
            </SettingRow>
          ))}
        </ul>
      ) : null}
      {error === null ? null : <p className="settings-message" role="alert">{error}</p>}
    </>
  );
}
