export interface FeedOrderFields {
  id: string;
  day: string;
  arrivedAt: string;
  concernId: string | null;
}

export function interestHit(item: Pick<FeedOrderFields, 'concernId'>): boolean {
  return item.concernId !== null;
}

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
