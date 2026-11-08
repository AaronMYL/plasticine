// 信息流列表的先后（2026-11-04 用户定：命中关注点的条目只在信息流里排前面，不再另开任务）。服务端的 SQL
// （state/feed-items.ts 的 LIST_ORDER）、客户端就地换上一条、假接口都按这一份，翻页和事件流来的一条才对得上。
//
// 排序规则：
// 1. 先按到达的那一天（条目的 day），新的一天在前——信息流仍是按天往下翻的时间线，旧的命中不会压过今天的新内容；
// 2. 同一天里，命中关注点的排前面；
// 3. 再按到达时间，新的在前；最后按标识倒序，保证先后稳定。
//
// 命中关注点：条目是从某个关注点搜来的，带着那个关注点的探索方向（concernId 有值）。和「事与来源」记触发时的
// feed.interest_hit 是同一个判定（app/assemble.ts）。

export interface FeedOrderFields {
  id: string;
  day: string;
  arrivedAt: string;
  concernId: string | null;
}

export function interestHit(item: Pick<FeedOrderFields, 'concernId'>): boolean {
  return item.concernId !== null;
}

/** 按码位比，和 SQLite 默认的 BINARY 排序一致（localeCompare 会按语言规则排，标识里的大小写、符号就对不上）。 */
function binary(a: string, b: string): number {
  if (a === b) { return 0; }
  return a < b ? -1 : 1;
}

export function compareFeedItems(a: FeedOrderFields, b: FeedOrderFields): number {
  const byDay = binary(b.day, a.day);
  if (byDay !== 0) { return byDay; }
  const byHit = Number(interestHit(b)) - Number(interestHit(a));
  if (byHit !== 0) { return byHit; }
  return binary(b.arrivedAt, a.arrivedAt) || binary(b.id, a.id);
}
