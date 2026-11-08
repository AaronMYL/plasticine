// M5 乙路的变化提交之后推到每条打开的事件流（shared/api/m5b-events.ts）：一笔账、一封站内信（带铃上的未读数）、
// 云端浏览器的页面。工具组开关的事件由 tool-groups.ts 自己在本人确认提交后推。

import { publishInboxContact } from './contact-streams.ts';
import type { AppDeps } from './context.ts';
import { inboxRowView, moneyEntryView } from './m5b-views.ts';

export function attachM5bStreams(deps: AppDeps): void {
  const { state, hub, m5b } = deps;
  const { life, inbox, cloud } = m5b;
  life.money.attach({
    entryChanged: (entry) => hub.publish({ type: 'money_changed', entry: moneyEntryView(state, entry) }),
  });
  inbox.attach({
    messageChanged: (message) => {
      hub.publish({ type: 'inbox_changed', message: inboxRowView(message), unread: inbox.unread() });
      // 第 113 条：站内信并进联系人，邮件和系统来源的联系人跟着变。
      publishInboxContact({ state, hub }, message);
    },
  });
  cloud.browser.attach({ browserChanged: (browser) => hub.publish({ type: 'browser_changed', browser }) });
}
