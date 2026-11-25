import {
  EMPTY_SPACE_DOC,
  type Space,
  type SpaceAuthor,
  type SpaceEdition,
  type SpaceGenre,
  type SpaceMetadata,
  type Subscription,
  type SubscriptionRule,
  type SubscriptionSettings,
} from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { SubsError } from './errors.ts';
import { checkSpacePage, editSpaceHtml, type SpaceEdit } from './space-page.ts';

export type SpaceState = Pick<StateService, 'spaces' | 'subscriptions' | 'transaction'>;

export interface SpaceWrite extends Partial<SpaceMetadata> {
  lineId?: string;
  id?: string;
  version?: number;
  title: string;
  genre?: SpaceGenre;
  html?: string;
  subscriptionId?: string;
  edition?: SpaceEdition;
  change?: string;
  rule?: string;
}

export interface SpaceWritten {
  space: Space;
  removed: string[];
}

interface Page {
  genre: SpaceGenre;
  html: string;
}

function metadataOf(input: SpaceWrite): Partial<SpaceMetadata> {
  return { ...(input.category === undefined ? {} : { category: input.category }),
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    ...(input.bookId === undefined ? {} : { bookId: input.bookId }),
    ...(input.folder === undefined ? {} : { folder: input.folder }) };
}

function newIssue(state: SpaceState, input: SpaceWrite, page: Page, author: SpaceAuthor): Space {
  const subscription = state.subscriptions.get(input.subscriptionId ?? '');
  if (subscription === undefined) {
    throw new SubsError('not_found', '没有这个订阅；先用 subscription_draft 建订阅。');
  }
  if (subscription.kind === 'review' && input.edition === undefined) {
    throw new SubsError('invalid', '个人回顾的一期要写 edition（daily 日报 / weekly 周报）。');
  }
  if (page.genre === 'letter' && subscription.kind !== 'review') {
    throw new SubsError('invalid', '来信只给个人回顾的日报和周报；研究周报写成报告（genre report）。');
  }
  const space = state.spaces.create({ title: input.title, doc: EMPTY_SPACE_DOC, genre: page.genre, html: page.html,
    author, category: page.genre, ...metadataOf(input), subscriptionId: subscription.id,
    issueNumber: state.spaces.nextIssueNumber(subscription.id),
    edition: subscription.kind === 'review' ? input.edition ?? null : null },
  { change: input.change ?? null, rule: input.rule ?? null, lineId: input.lineId ?? null });
  if (subscription.status === 'draft') {
    state.subscriptions.update(subscription.id, subscription.version, { status: 'sample' });
  }
  return space;
}

function letterAllowed(state: SpaceState, space: Space): boolean {
  if (space.genre === 'letter') return true;
  const subscription = space.subscriptionId === null ? undefined : state.subscriptions.get(space.subscriptionId);
  return subscription?.kind === 'review';
}

function existing(state: SpaceState, input: SpaceWrite, author: SpaceAuthor): SpaceWritten {
  if (input.id === undefined || input.version === undefined) {
    throw new SubsError('invalid', '改已有的空间要带刚读到的 version（先 space_read）。');
  }
  const current = state.spaces.require(input.id);
  const note = { change: input.change ?? null, rule: input.rule ?? null, lineId: input.lineId ?? null };
  if (input.html === undefined) {
    const space = state.spaces.save(input.id, input.version,
      { title: input.title, ...metadataOf(input) }, author, note);
    return { space, removed: [] };
  }
  const genre = input.genre ?? current.genre ?? 'report';
  if (genre === 'letter' && !letterAllowed(state, current)) {
    throw new SubsError('invalid', '来信只给个人回顾的日报和周报；这一页写成报告（genre report）。');
  }
  const checked = checkSpacePage(genre, input.html);
  const space = state.spaces.save(input.id, input.version,
    { title: input.title, genre, html: checked.html, ...metadataOf(input) },
    author, note);
  return { space, removed: checked.removed };
}

export function writeSpace(state: SpaceState, input: SpaceWrite, author: SpaceAuthor): SpaceWritten {
  if (input.id !== undefined) {
    return state.transaction(() => existing(state, input, author));
  }
  if (input.genre === undefined || input.html === undefined) {
    throw new SubsError('invalid', '新空间要写 genre（report 报告 / letter 来信）和 html（body 里的正文）。');
  }
  const checked = checkSpacePage(input.genre, input.html);
  const page = { genre: input.genre, html: checked.html };
  return state.transaction(() => {
    if (input.subscriptionId !== undefined) {
      return { space: newIssue(state, input, page, author), removed: checked.removed };
    }
    if (page.genre === 'letter') {
      throw new SubsError('invalid', '来信只给个人回顾的日报和周报；别的写成报告（genre report）。');
    }
    const space = state.spaces.create({ title: input.title, doc: EMPTY_SPACE_DOC, genre: page.genre,
      html: page.html, author, ...metadataOf(input) },
    { change: input.change ?? null, rule: input.rule ?? null, lineId: input.lineId ?? null });
    return { space, removed: checked.removed };
  });
}

export function editSpace(state: SpaceState, input: { id: string; version: number; edits: readonly SpaceEdit[];
  change?: string; rule?: string; lineId?: string }, author: SpaceAuthor): SpaceWritten {
  const current = state.spaces.require(input.id);
  if (current.html === null) {
    throw new SubsError('invalid', '这一页还是旧版式，没有网页正文可改：用 space_write 带 genre 和 html 整页重写。');
  }
  if (current.version !== input.version) {
    throw new SubsError('conflict', `这一页已经是第 ${current.version} 版了：先 space_read 拿到最新的再改。`);
  }
  const html = editSpaceHtml(current.html, input.edits);
  return writeSpace(state, { id: current.id, version: input.version, title: current.title, html,
    ...(input.lineId === undefined ? {} : { lineId: input.lineId }),
    ...(input.change === undefined ? {} : { change: input.change }),
    ...(input.rule === undefined ? {} : { rule: input.rule }) }, author);
}

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
  status?: 'active' | 'paused';
}

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
