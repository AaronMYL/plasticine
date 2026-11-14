// 设置 · 通用 · 通知 ·「通知哪些事」（第13批，11-14 Aaron：「通知消息可以按类型在设置中开关」，看过设计稿弹框都选推荐）：
// 七类各一个开关，所有设备一起生效（存在服务器上）；关掉的那一类只是不弹系统通知，对话和消息里照常有、红点照常亮。
// 「等你的事」关着时开关下面写一句后果。设计稿 NotifyTypes / NotifyTypesPhone。

import type { ReactNode } from 'react';
import type { NotifyKind } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import { useStore } from '../../state/use-store.ts';
import './notify-kinds-section.css';

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

export function NotifyKindsSection(): ReactNode {
  const live = useLive();
  const kinds = useStore(live.push.kinds);
  const error = useStore(live.push.kindsError);
  return (
    <div className="notify-kinds">
      <div className="notify-kinds-head">
        <h4 id="settings-notify-kinds" className="notify-kinds-title">通知哪些事</h4>
        <InfoTip label="通知哪些事的说明" text={TIP} />
      </div>
      <ul className="notify-kinds-list" aria-labelledby="settings-notify-kinds">
        {ROWS.map((row) => (
          <li key={row.kind} className="notify-kinds-row">
            <span className="notify-kinds-name">
              {row.label}
              {row.tip === undefined ? null : <InfoTip label={`${row.label}的说明`} text={row.tip} />}
            </span>
            <input type="checkbox" role="switch" aria-label={row.label} checked={kinds[row.kind]}
              onChange={(event) => void live.push.setKind(row.kind, event.target.checked)} />
            {row.kind === 'ask' && !kinds.ask
              ? <p className="notify-kinds-warn" role="note">要你同意、回答的事不会弹出来，记得去首页「等你」看。</p>
              : null}
          </li>
        ))}
      </ul>
      {error === null ? null : <p className="settings-message" role="alert">{error}</p>}
    </div>
  );
}
