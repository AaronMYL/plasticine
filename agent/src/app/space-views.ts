// 空间和订阅的接口形状（shared/api/spaces.ts）：从库里的对象拼出界面要的样子；不做业务判断、不写库。

import type {
  IssueBrief,
  ReviewSummary,
  SpaceKind,
  SpaceListItem,
  SpaceView,
  SubscriptionListItem,
  SubscriptionView,
} from '../../shared/api/index.ts';
import type { Space, Subscription } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { nextRunAt, pageSummary, REVIEW_SUBSCRIPTION_ID, schedulesOf, summaryOf } from '../subs/index.ts';

type ViewState = Pick<StateService, 'spaces' | 'subscriptions' | 'memoryDreams'>;

// 首页「回顾」：一周内的那一期才算最近；一天半之内做完的整理才算「昨晚」。
const REVIEW_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const DREAM_FRESH_MS = 36 * 60 * 60 * 1000;

function kindOf(state: ViewState, space: Space): SpaceKind {
  if (space.subscriptionId === null) {
    return 'space';
  }
  return state.subscriptions.get(space.subscriptionId)?.kind ?? 'space';
}

export function spaceListItem(state: ViewState, space: Space): SpaceListItem {
  return { id: space.id, title: space.title, category: space.category, sourceUrl: space.sourceUrl,
    bookId: space.bookId, folder: space.folder, kind: kindOf(state, space), genre: space.genre, author: space.author,
    subscriptionId: space.subscriptionId, issueNumber: space.issueNumber, edition: space.edition,
    version: space.version, createdAt: space.createdAt, updatedAt: space.updatedAt };
}

function lastChange(state: ViewState, space: Space, subscription: Subscription | undefined): SpaceView['lastChange'] {
  const revision = state.spaces.revision(space.id, space.version);
  if (revision === undefined || revision.change === null || revision.version === 1) {
    return null;
  }
  const adopted = revision.rule !== null
    && (subscription?.settings.rules.some((rule) => rule.text === revision.rule) ?? false);
  return { version: revision.version, change: revision.change, rule: revision.rule, adopted };
}

export function spaceView(state: ViewState, space: Space): SpaceView {
  const subscription = space.subscriptionId === null ? undefined : state.subscriptions.get(space.subscriptionId);
  return {
    id: space.id, title: space.title, category: space.category, sourceUrl: space.sourceUrl,
    bookId: space.bookId, folder: space.folder, version: space.version, kind: kindOf(state, space), genre: space.genre,
    author: space.author, createdAt: space.createdAt, updatedAt: space.updatedAt, html: space.html, doc: space.doc,
    subscription: subscription === undefined ? null
      : { id: subscription.id, title: subscription.title, version: subscription.version },
    issueNumber: space.issueNumber, edition: space.edition, lastChange: lastChange(state, space, subscription),
  };
}

export function issueBrief(space: Space): IssueBrief | null {
  if (space.subscriptionId === null || space.issueNumber === null) {
    return null;
  }
  const { headline, stats } = space.html === null ? summaryOf(space.title, space.doc)
    : pageSummary(space.title, space.genre ?? 'report', space.html);
  return { spaceId: space.id, subscriptionId: space.subscriptionId, issueNumber: space.issueNumber,
    edition: space.edition, genre: space.genre, title: space.title, headline, stats, createdAt: space.createdAt };
}

function briefs(state: ViewState, subscriptionId: string): IssueBrief[] {
  return state.spaces.issues(subscriptionId).map(issueBrief).filter((brief): brief is IssueBrief => brief !== null);
}

export function subscriptionListItem(state: ViewState, subscription: Subscription): SubscriptionListItem {
  const issues = briefs(state, subscription.id);
  return { id: subscription.id, title: subscription.title, kind: subscription.kind, status: subscription.status,
    latest: issues[0] ?? null, issueCount: issues.length };
}

export function subscriptionView(state: ViewState, subscription: Subscription, now: Date): SubscriptionView {
  const next = schedulesOf(subscription)
    .map((slot) => nextRunAt(slot.schedule, slot.timeZone, now).getTime())
    .sort((a, b) => a - b)[0];
  return { id: subscription.id, title: subscription.title, kind: subscription.kind, status: subscription.status,
    version: subscription.version, settings: subscription.settings, timeZone: subscription.timeZone,
    lastRunAt: subscription.lastRunAt, nextRunAt: next === undefined ? null : new Date(next).toISOString(),
    issues: briefs(state, subscription.id) };
}

export function reviewSummary(state: ViewState, now: Date): ReviewSummary {
  const latest = briefs(state, REVIEW_SUBSCRIPTION_ID)[0];
  const fresh = latest !== undefined && now.getTime() - Date.parse(latest.createdAt) <= REVIEW_FRESH_MS;
  const dream = state.memoryDreams.latest();
  const recent = dream?.finishedAt != null && now.getTime() - Date.parse(dream.finishedAt) <= DREAM_FRESH_MS;
  let dreamSummary: ReviewSummary['dream'] = null;
  if (dream?.finishedAt != null && recent) {
    const changes = state.memoryDreams.changes(dream.id).filter((change) => change.undoneAt === null);
    const count = (kind: string): number => changes.filter((change) => change.kind === kind).length;
    dreamSummary = changes.length === 0 ? null : { finishedAt: dream.finishedAt, total: changes.length,
      add: count('add'), replace: count('replace'), unsure: count('unsure') };
  }
  return { latest: fresh ? latest : null, dream: dreamSummary };
}
