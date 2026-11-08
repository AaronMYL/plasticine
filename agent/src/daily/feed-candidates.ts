// 关注点搜索的材料：来源、偏好、过滤和轮流取材；不调模型、不写条目。第 3 批（11-04）起订阅不再走这里，直接进信息流
// （feed-subscriptions.ts）。
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { searchTerms } from '../../shared/feed-search.ts';
import { FEED_SELECTION_LIMIT, type FeedCandidate } from '../../shared/feed-selection.ts';
import type { FeedSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { errorCategory, failureText, safeLog } from '../shared-log.ts';
import type { FeedFetcher } from './feed-fetch.ts';
import { BUILT_IN_SOURCES } from './feed.ts';
import { cleanSite } from './link-data.ts';
import { searchNews } from './search-feed.ts';
import type { SearchHit } from './search-parse.ts';
import { cleanUrl } from './urls.ts';

// 10-29 沿用旧版上限与计分；不是共同状态里表示证据来源的 w。
const INTEREST_LIMIT = 8;
const CANDIDATE_LIMIT = 40;
const ROUND_COST = 2;
const ARTICLE_WINDOW_MS = 48 * 60 * 60 * 1000;
export const REACTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const LEVEL_BASE = { more: 3, normal: 2, less: 1, off: 0 };
const LegacyQuerySchema = Type.Object({ row: Type.Object({
  origin: Type.Optional(Type.String()), queryEdited: Type.Optional(Type.Boolean()),
}) });

export function sourceSearchTerms(source: FeedSource): string[] {
  const old = Value.Check(LegacyQuerySchema, source.legacyPayload) ? source.legacyPayload.row : undefined;
  const custom = source.queryEdited || !source.migratedDefault || old?.queryEdited === true || old?.origin === 'user';
  return searchTerms({ label: source.label, query: source.query, custom });
}

export function interestWeight(level: FeedSource['level'], score: number): number {
  return level === 'off' ? 0 : Math.max(0.5, LEVEL_BASE[level] + Math.max(-1, Math.min(2, score / 3)));
}

export function looksLikeArticle(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); }
  catch { return false; }
  if (/(^|\.)(wikipedia\.org|baike\.baidu\.com)$/i.test(url.hostname)
    || (/(^|\.)zhihu\.com$/i.test(url.hostname) && /^\/topic(?:\/|$)/i.test(url.pathname))) {
    return false;
  }
  const path = url.pathname.replace(/\/+$/, '');
  return path.length > 0 || ['p', 'id', 'article', 'article_id', 'story', 'newsid']
    .some((key) => Boolean(url.searchParams.get(key)));
}

/** 旧版带额度的轮流取：多档每轮 1–2 条，少档隔轮一条；不改变输入数组。 */
export function interleave(candidates: readonly FeedCandidate[], limit = CANDIDATE_LIMIT): FeedCandidate[] {
  const groups = new Map<string, FeedCandidate[]>();
  for (const item of candidates) {
    const group = groups.get(item.sourceId) ?? [];
    group.push(item);
    groups.set(item.sourceId, group);
  }
  const queues = [...groups.values()].map((items) => ({
    items: items.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')),
    weight: items[0]?.weight ?? 0.5, credit: 0,
  })).sort((a, b) => b.weight - a.weight);
  const result: FeedCandidate[] = [];
  while (result.length < limit && queues.some((queue) => queue.items.length > 0)) {
    for (const queue of queues) {
      if (queue.items.length === 0) { continue; }
      queue.credit += queue.weight;
      while (queue.credit >= ROUND_COST && queue.items.length > 0 && result.length < limit) {
        const item = queue.items.shift();
        if (item !== undefined) { result.push(item); }
        queue.credit -= ROUND_COST;
      }
    }
  }
  return result;
}

export async function collectCandidates(state: StateService, fetcher: FeedFetcher, now: Date, signal: AbortSignal) {
  const sources = state.feedSources.all();
  const searching = sources.find((source) => source.ref === BUILT_IN_SOURCES.news.ref)?.level !== 'off';
  const since = new Date(now.getTime() - REACTION_WINDOW_MS).toISOString();
  const scores = state.feedItems.reactionScores(since);
  const weight = (source: FeedSource) => interestWeight(source.level, scores.get(source.id) ?? 0);
  const interests = sources.filter((source) => searching && source.kind === 'interest' && source.level !== 'off')
    .sort((a, b) => weight(b) - weight(a)).slice(0, INTEREST_LIMIT);
  const blocked = new Set(sources.filter((source) => source.kind === 'blocked_site' && source.level === 'off')
    .map((source) => cleanSite(source.label)?.replace(/^www\./, '')));
  const banned = (state.dailySettings.read().settings.feedBannedTerms ?? []).map((word) => word.trim()).filter(Boolean);
  const seen = state.feedItems.knownUrls();
  const candidates: FeedCandidate[] = [];
  let failures = 0;
  const errors: string[] = [];
  const add = (hit: SearchHit, source: FeedSource, via: string): boolean => {
    const url = cleanUrl(hit.url);
    const host = new URL(url).hostname.replace(/^www\./, '');
    const at = hit.publishedAt === null ? null : Date.parse(hit.publishedAt);
    if (seen.has(url) || blocked.has(host) || blocked.has(cleanSite(hit.site)?.replace(/^www\./, ''))
      || !looksLikeArticle(url) || (at !== null && (at < now.getTime() - ARTICLE_WINDOW_MS || at > now.getTime()))
      || banned.some((word) => hit.title.includes(word) || hit.text.includes(word))) {
      return false;
    }
    seen.add(url);
    candidates.push({ ...hit, url, id: createHash('sha256').update(url).digest('hex'),
      sourceId: source.id, sourceLabel: source.label, via, weight: weight(source) });
    return true;
  };
  const failed = (source: FeedSource, error: unknown): void => {
    signal.throwIfAborted();
    failures += 1;
    errors.push(`${source.label}：${failureText(error)}`);
    safeLog('warn', 'feed_source_failed', { objectId: source.id, category: errorCategory(error), error });
  };
  const searches = await Promise.all(interests.flatMap((source) => sourceSearchTerms(source).map(async (term) => {
    signal.throwIfAborted();
    try {
      return { source, hits: await searchNews(term, fetcher, signal) };
    } catch (error) {
      failed(source, error);
      return { source, hits: [] };
    }
  })));
  // 请求并行，归属按权重顺序确定，不让网络返回先后改变重复链接的关注点。
  for (const { source, hits } of searches) {
    for (const hit of hits) { add(hit, source, '搜索'); }
  }
  return { candidates: interleave(candidates), interests, failures, errors,
    reactions: state.feedItems.reactionSummary(since) };
}
