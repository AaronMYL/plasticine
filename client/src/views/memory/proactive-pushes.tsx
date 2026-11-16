// 主动告诉你 ·「最近」里推到手机的每一条（11-16 设计稿）：推了什么、谁推的、什么时候；⋯ 里「打开那段对话」「撤回」。
// 撤回的划掉、写「已撤回」；开着的网页收到 pushes_changed 后把手机、电脑上还挂着的那条系统通知收掉（push-switch.ts）。

import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import type { PushRecord } from '../../api/shared.ts';
import { useLive, useTimeZone } from '../../live.tsx';
import { showToast } from '../../primitives/toast/index.tsx';
import { DropdownMenu } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { parseHash, type Route } from '../../shell/routes.ts';
import { timeText } from '../../shell/time-text.ts';
import { useRead } from '../settings/system-read.tsx';

export function usePushes(): { pushes: PushRecord[] | null; error: string | null } {
  const api = useApi();
  const live = useLive();
  const list = useRead((signal) => api.pushes.list(signal), [api]);
  useEffect(() => live.hub.on((event) => {
    if (event.type === 'pushes.changed' || event.type === 'resync') list.reload();
  }), [live.hub]);
  return { pushes: list.value, error: list.error };
}

function PushRow({ push, now, navigate }: { push: PushRecord; now: Date; navigate: (route: Route) => void }):
  ReactNode {
  const api = useApi();
  const timeZone = useTimeZone();
  const [withdrawnAt, setWithdrawnAt] = useState(push.withdrawnAt);
  const withdrawn = withdrawnAt !== null;
  const withdraw = (): void => {
    api.pushes.withdraw(push.id).then((next) => setWithdrawnAt(next.withdrawnAt),
      (cause: unknown) => showToast({ text: `没撤回：${errorText(cause)}`, tone: 'error' }));
  };
  const when = timeText(push.createdAt, now, timeZone);
  return (
    <li className="push-row" data-withdrawn={withdrawn ? '' : undefined}>
      <Icon name="bell" size={16} />
      <span className="push-row-text">
        <span className="push-row-title">{push.title}</span>
        <span className="push-row-sub">{push.from} · {withdrawn ? '已撤回' : '推到手机'} · {when}</span>
      </span>
      <DropdownMenu label={`这条推送的更多操作：${push.title}`} tip="更多" className="icon-button" align="end" rowMenu
        items={[
          { label: '打开那段对话', icon: 'conversation', onSelect: () => navigate(parseHash(push.url.slice(1))) },
          { label: '撤回', icon: 'undo', disabled: withdrawn, onSelect: withdraw },
        ]}>
        <Icon name="more" size={16} />
      </DropdownMenu>
    </li>
  );
}

export function RecentPushes({ pushes, now, navigate }: { pushes: readonly PushRecord[]; now: Date;
  navigate: (route: Route) => void }): ReactNode {
  if (pushes.length === 0) return null;
  return (
    <ul className="push-rows" aria-label="推到手机的">
      {pushes.map((push) => <PushRow key={`${push.id}:${push.withdrawnAt ?? ''}`} push={push} now={now}
        navigate={navigate} />)}
    </ul>
  );
}
