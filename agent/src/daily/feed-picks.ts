import { Value } from 'typebox/value';
import { FeedSelectionSchema, type FeedSelection, type FeedSelectionInput,
  type FeedSelector } from '../../shared/feed-selection.ts';
import { bounded } from './feed-fetch.ts';
import { cleanLinkData } from './link-data.ts';
import { DailyError } from './errors.ts';
import { failureText } from '../shared-log.ts';

const SELECT_TIMEOUT_MS = 90_000;
type Picked = FeedSelection['items'][number];

function titleKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
}

/** 搜索命中只是候选。只有内容归属确认过的才写入，不把模型丢掉的报道按数量补回来。 */
export async function pickFeed(input: FeedSelectionInput, select: FeedSelector, signal: AbortSignal) {
  const picks: Picked[] = [];
  const used = new Set<string>();
  const titles = new Set<string>();
  const events = new Set<string>();
  const candidates = new Map(input.candidates.map((item) => [item.id, item]));
  const interests = new Set(input.interests.map((item) => item.id));
  try {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(SELECT_TIMEOUT_MS)]);
    const selected = await bounded(select(cleanLinkData(input), deadline), deadline);
    signal.throwIfAborted();
    if (!Value.Check(FeedSelectionSchema, selected) || selected.items.some((pick) => !candidates.has(pick.id))) {
      throw new DailyError('invalid_input', '选材结果无法核对，请稍后刷新。');
    }
    if (selected.items.some((pick) => pick.sourceId !== null && !interests.has(pick.sourceId))) {
      throw new DailyError('invalid_input', '选材指向了不存在或已关闭的关注点，请稍后刷新。');
    }
    for (const pick of selected.items) {
      const candidate = candidates.get(pick.id)!;
      if (used.has(pick.id) || (candidate.via === '搜索' && pick.sourceId === null)) { continue; }
      used.add(pick.id);
      const title = titleKey(candidate.title);
      if (events.has(pick.event) || titles.has(title)) { continue; }
      events.add(pick.event);
      titles.add(title);
      picks.push(pick);
    }
    return { picks, error: null };
  } catch (cause) {
    signal.throwIfAborted();
    return { picks: [], error: `选材未完成：${failureText(cause)}；这次未写入未经判断的新闻，可稍后刷新。` };
  }
}
