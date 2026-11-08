// 空间和订阅的写（第 6、7 条）：Plasticine 写空间、他在空间里直接改、撤销、「以后都这样」、改订阅设置、开定时。
// 单期修改和长期规则分开：改一期只改这一期（这一版带着 Plasticine 提的规则）；点了「以后都这样」才写进订阅设置。

import type {
  Space,
  SpaceAuthor,
  SpaceDoc,
  SpaceEdition,
  Subscription,
  SubscriptionRule,
  SubscriptionSettings,
} from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { SubsError } from './errors.ts';
import { checkSpaceDoc } from './space-doc.ts';

export type SpaceState = Pick<StateService, 'spaces' | 'subscriptions' | 'transaction'>;

export interface SpaceWrite {
  /** 改已有的空间时给 id 和刚读到的 version；不给就是新建。 */
  id?: string;
  version?: number;
  title: string;
  doc: unknown;
  /** 订阅的一期：新建时给。 */
  subscriptionId?: string;
  edition?: SpaceEdition;
  /** 这一版改了什么（「图从 4 张减到 1 张」）。 */
  change?: string;
  /** 提给他的「以后都这样」（「每期最多 1 张图」）：只记在这一版上，他点了才写进订阅。 */
  rule?: string;
}

function newIssue(state: SpaceState, input: SpaceWrite, doc: SpaceDoc, author: SpaceAuthor): Space {
  const subscription = state.subscriptions.get(input.subscriptionId ?? '');
  if (subscription === undefined) {
    throw new SubsError('not_found', '没有这个订阅；先用 subscription_draft 建订阅。');
  }
  if (subscription.kind === 'review' && input.edition === undefined) {
    throw new SubsError('invalid', '个人回顾的一期要写 edition（daily 日报 / weekly 周报）。');
  }
  const space = state.spaces.create({ title: input.title, doc, author, subscriptionId: subscription.id,
    issueNumber: state.spaces.nextIssueNumber(subscription.id),
    edition: subscription.kind === 'review' ? input.edition ?? null : null },
  { change: input.change ?? null, rule: input.rule ?? null });
  // 草案出的第一期就是样刊：等他看过、按反馈调，再开定时。
  if (subscription.status === 'draft') {
    state.subscriptions.update(subscription.id, subscription.version, { status: 'sample' });
  }
  return space;
}

/** 写一个空间：新建，或带 version 存成新的一版。正文先核对（图表数据、来源、出处）。 */
export function writeSpace(state: SpaceState, input: SpaceWrite, author: SpaceAuthor): Space {
  const doc = checkSpaceDoc(input.doc);
  return state.transaction(() => {
    if (input.id === undefined) {
      if (input.subscriptionId !== undefined) {
        return newIssue(state, input, doc, author);
      }
      return state.spaces.create({ title: input.title, doc, author }, { change: input.change ?? null,
        rule: input.rule ?? null });
    }
    if (input.version === undefined) {
      throw new SubsError('invalid', '改已有的空间要带刚读到的 version（先 space_read）。');
    }
    return state.spaces.save(input.id, input.version, { title: input.title, doc }, author,
      { change: input.change ?? null, rule: input.rule ?? null });
  });
}

/** 「以后都这样」：把这一期某一版上的规则写进订阅设置，记着是第几期加的。同一句不重复加。 */
export function adoptRule(state: SpaceState, subscriptionId: string, version: number, spaceId: string,
  spaceVersion: number, now: string): Subscription {
  const space = state.spaces.require(spaceId);
  if (space.subscriptionId !== subscriptionId) {
    throw new SubsError('invalid', '这个空间不是这个订阅的一期。');
  }
  const rule = state.spaces.revision(spaceId, spaceVersion)?.rule ?? null;
  if (rule === null) {
    throw new SubsError('invalid', '这一版没有可以「以后都这样」的规则。');
  }
  const subscription = state.subscriptions.require(subscriptionId);
  if (subscription.settings.rules.some((item) => item.text === rule)) {
    return subscription;
  }
  const added: SubscriptionRule = { text: rule, fromIssue: space.issueNumber, addedAt: now };
  const settings = { ...subscription.settings, rules: [...subscription.settings.rules, added] };
  return state.subscriptions.update(subscriptionId, version, { settings });
}

export interface SubscriptionChange {
  title?: string;
  settings?: SubscriptionSettings;
  /** 他能做的：开定时（active）、暂停（paused）。 */
  status?: 'active' | 'paused';
}

/** 改订阅：设置的种类不能变；没出过样刊不能开定时（先出一期，按反馈调好再开）。 */
export function changeSubscription(state: SpaceState, id: string, version: number,
  change: SubscriptionChange): Subscription {
  const current = state.subscriptions.require(id);
  if (change.settings !== undefined && change.settings.kind !== current.kind) {
    throw new SubsError('invalid', '订阅的种类不能改。');
  }
  if (change.status === 'active' && current.status !== 'active' && current.status !== 'paused'
    && state.spaces.issues(id).length === 0) {
    throw new SubsError('conflict', '还没出过样刊：先出一期，看过再开定时。');
  }
  return state.subscriptions.update(id, version, {
    ...(change.title === undefined ? {} : { title: change.title }),
    ...(change.settings === undefined ? {} : { settings: change.settings }),
    ...(change.status === undefined ? {} : { status: change.status }),
  });
}
