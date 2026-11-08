// 样刊出来时附一张卡（第 7 批第 14 条，他定，设计稿 Chat-Sample）：订阅还没开定时时写出的那一期就是样刊，写完在主线
// 摊开一张要你定卡——「每周五 08:00 出一期」+ 订阅名，按钮「开启定时」（推荐）/「再改改」。点「开启定时」服务端直接把
// 订阅改成 active，主线回一句确认；点「再改改」交回主线，Plasticine 问他想改哪里。
// 一期一张：动作标识是 subscription-start:<订阅>:<那一期>，同一期再要拿回原来那张（答过的也不重出）。服务起来时补一遍
// （draft / sample、出过至少一期、那一期还没出过卡的）：11-08 他那份「认知科学与意识研究周报」就是这样收到的。

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
  /** 主线上放一句系统消息（不开一轮）：开好定时的确认。 */
  notice: (input: { key: string; text: string; brief: string }) => void;
  /** 交给主线一句话（开一轮）：「再改改」。 */
  tell: (text: string) => void;
}

/** 「每周五 08:00 出一期」：按订阅设置拼，他所在地的时间。 */
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

  /** 这个订阅还没开定时、出过一期：给最新那一期出卡（已经出过就拿回那张）。不该出就是 null。 */
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

  /** 服务起来时补一遍：还没开定时、出过样刊的订阅，最新那一期没出过卡的出一张。 */
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

  /** 卡答了：开启定时就在同一个事务里改订阅；再改改交回主线。 */
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
