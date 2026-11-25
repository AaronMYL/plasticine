import type { SubscriptionCardPreview } from '../../shared/api/schedule-card.ts';
import type { Ask, Subscription } from '../../shared/state.ts';
import type { AskDesk, AskResolver } from '../attention/index.ts';
import type { StateService } from '../state/index.ts';
import { spacePath } from './tools.ts';
import { changeSubscription, type SpaceState } from './writes.ts';

export const SAMPLE_CARD_PURPOSE = 'subscription_schedule';
const START = 'start';
const REVISE = 'revise';
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const EDITIONS = { daily: '日报', weekly: '周报' } as const;

export type SampleCardState = SpaceState & Pick<StateService, 'asks'>;

export interface SampleCardOptions {
  state: SampleCardState;
  desk: AskDesk;
  notice: (input: { key: string; text: string; brief: string }) => void;
  tell: (text: string) => void;
}

export function scheduleText(subscription: Subscription): string {
  const { settings } = subscription;
  if (settings.kind === 'research') {
    const { every, weekday, time } = settings.schedule;
    return every === 'day' ? `每天 ${time} 出一期` : `每${WEEKDAYS[weekday ?? 1]} ${time} 出一期`;
  }
  const parts = [settings.daily.on ? `每天 ${settings.daily.time} 出${EDITIONS.daily}` : '',
    settings.weekly.on ? `每${WEEKDAYS[settings.weekly.weekday]} ${settings.weekly.time} 出${EDITIONS.weekly}` : '']
    .filter((part) => part !== '');
  return parts.length === 0 ? '按时出' : parts.join('、');
}

function waitingForSchedule(subscription: Subscription): boolean {
  return subscription.status === 'draft' || subscription.status === 'sample';
}

function previewOf(ask: Ask): SubscriptionCardPreview | null {
  const preview = ask.context?.['subscription'];
  return typeof preview === 'object' && preview !== null ? preview as SubscriptionCardPreview : null;
}

export class SampleCards {
  readonly #options: SampleCardOptions;

  constructor(options: SampleCardOptions) {
    this.#options = options;
  }

  offer(subscriptionId: string): Ask | null {
    const { state, desk } = this.#options;
    const subscription = state.subscriptions.get(subscriptionId);
    if (subscription === undefined || !waitingForSchedule(subscription)) {
      return null;
    }
    const latest = state.spaces.issues(subscriptionId)[0];
    if (latest === undefined) {
      return null;
    }
    const when = scheduleText(subscription);
    const preview: SubscriptionCardPreview = { subscriptionId, title: subscription.title, when,
      spaceId: latest.id, issueNumber: latest.issueNumber };
    return desk.commit((changes) => desk.raise(changes, {
      kind: 'decide',
      purpose: SAMPLE_CARD_PURPOSE,
      question: when,
      detail: subscription.title,
      options: [{ id: START, label: '开启定时', recommended: true }, { id: REVISE, label: '再改改' }],
      actionId: `subscription-start:${subscriptionId}:${latest.id}`,
      context: { subscription: preview, link: spacePath(latest.id) },
      basis: 'inferred',
    }));
  }

  backfill(): number {
    let raised = 0;
    for (const subscription of this.#options.state.subscriptions.all()) {
      const before = this.#options.state.asks.byActionId(this.#actionFor(subscription.id) ?? '');
      if (before === undefined && this.offer(subscription.id) !== null) {
        raised += 1;
      }
    }
    return raised;
  }

  #actionFor(subscriptionId: string): string | null {
    const latest = this.#options.state.spaces.issues(subscriptionId)[0];
    return latest === undefined ? null : `subscription-start:${subscriptionId}:${latest.id}`;
  }

  readonly resolver: AskResolver = {
    resolve: (changes, ask) => {
      const preview = previewOf(ask);
      if (preview === null) {
        return;
      }
      const { state } = this.#options;
      const subscription = state.subscriptions.get(preview.subscriptionId);
      if (subscription === undefined) {
        return;
      }
      if (ask.answer?.optionId === START) {
        if (subscription.status !== 'active') {
          changeSubscription(state, subscription.id, subscription.version, { status: 'active' });
        }
        const text = `定时开好了：《${subscription.title}》${preview.when}。`;
        changes.afterCommit(() => this.#options.notice({ key: `subscription-active:${ask.id}`, text,
          brief: text }));
        return;
      }
      const issue = preview.issueNumber === null ? '样刊' : `第 ${preview.issueNumber} 期样刊`;
      changes.afterCommit(() => this.#options.tell(`他看了《${subscription.title}》${issue}，点了「再改改」。`
        + `问他想改哪里（方向、来源、频率、每期的结构），按他说的用 subscription_update 改，改好再用 subscription_run`
        + ` 出一期样刊。订阅编号：${subscription.id}，那一期：${spacePath(preview.spaceId)}。`));
    },
  };
}
