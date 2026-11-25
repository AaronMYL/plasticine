import { publishInboxContact } from './contact-streams.ts';
import type { AppDeps } from './context.ts';
import { inboxRowView, moneyEntryView } from './tool-group-views.ts';

export function attachToolGroupStreams(deps: AppDeps): void {
  const { state, hub, toolGroups } = deps;
  const { life, inbox, cloud } = toolGroups;
  life.money.attach({
    entryChanged: (entry) => hub.publish({ type: 'money_changed', entry: moneyEntryView(state, entry) }),
  });
  inbox.attach({
    messageChanged: (message) => {
      hub.publish({ type: 'inbox_changed', message: inboxRowView(message), unread: inbox.unread() });
      publishInboxContact({ state, hub }, message);
    },
  });
  cloud.browser.attach({ browserChanged: (browser) => hub.publish({ type: 'browser_changed', browser }) });
}
