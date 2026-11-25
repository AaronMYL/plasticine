import { useState, type ReactNode } from 'react';
import { useApi } from '../../api/context.tsx';
import { errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { SubscriptionListItem } from '../../api/shared.ts';
import { showResultToast } from '../../primitives/toast/index.tsx';
import type { RevealAction } from '../../shell/reveal-more.tsx';
import type { Route } from '../../shell/routes.ts';
import { spaceRoute } from '../spaces/space-links.ts';
import { SubscriptionSheet } from '../spaces/subscription-sheet.tsx';
import { libraryChanged } from './library-signal.ts';

type SubscriptionRef = Pick<SubscriptionListItem, 'id' | 'kind' | 'status'>;

export interface SubscriptionMenu {
  actions: (subscription: SubscriptionRef) => RevealAction[];
  dialogs: ReactNode;
  busy: boolean;
}

export function useSubscriptionMenu(phone: boolean, navigate: (route: Route) => void, onChanged?: () => void):
  SubscriptionMenu {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<string | null>(null);
  const act = (work: () => Promise<unknown>, done: string | null): void => {
    setBusy(true);
    work().then(() => {
      if (done !== null) showResultToast(done, false);
      libraryChanged();
      onChanged?.();
    }, (cause: unknown) => showResultToast(errorText(cause), true)).finally(() => setBusy(false));
  };
  const runNow = (subscription: SubscriptionRef): void => act(() => api.subscriptions.run(subscription.id, {
    requestId: createRequestId(), ...(subscription.kind === 'review' ? { edition: 'daily' as const } : {}) }),
  '在写了，写好会出现在往期里。');
  const setStatus = (subscription: SubscriptionRef, status: 'active' | 'paused'): void => act(async () => {
    const view = await api.subscriptions.get(subscription.id);
    await api.subscriptions.update(subscription.id, { requestId: createRequestId(), version: view.version, status });
  }, status === 'paused' ? '已暂停，不再按时出新的一期。' : '开启了定时。');
  const actions = (subscription: SubscriptionRef): RevealAction[] => [
    { icon: 'refresh', label: '现在出一期', disabled: busy, onSelect: () => runNow(subscription) },
    subscription.status === 'active'
      ? { icon: 'pause', label: '暂停', disabled: busy, onSelect: () => setStatus(subscription, 'paused') }
      : { icon: 'play', label: '开启定时', disabled: busy, onSelect: () => setStatus(subscription, 'active') },
    { icon: 'sliders', label: '订阅设置', onSelect: () => setSettings(subscription.id) },
  ];
  const close = (): void => {
    setSettings(null);
    libraryChanged();
    onChanged?.();
  };
  const dialogs = settings === null ? null
    : <SubscriptionSheet open subscriptionId={settings} phone={phone} onClose={close} onOpenIssue={(id) => {
      setSettings(null);
      navigate(spaceRoute(id));
    }} />;
  return { actions, dialogs, busy };
}
