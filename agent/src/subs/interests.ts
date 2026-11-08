// 认定兴趣（第 7 条，11-06 定）：明确关注的主题 > 收藏 > 正在推进的项目 > 近期交流。交流里的话题要在不同的几天里
// 反复出现才算，只问过一次的不算。顺序就是优先级；同一个名字只留排得最高的那一条。

export type InterestWhy = 'explicit' | 'saved' | 'project' | 'talk';

export interface Interest {
  label: string;
  why: InterestWhy;
  /** 交流里出现在几天（只有 talk 有）。 */
  days?: number;
  /** 能点回去的东西（项目 id、记忆文档 id）。 */
  ref?: string;
}

export interface InterestInput {
  explicit: readonly string[];
  saved: readonly string[];
  projects: readonly { id: string; name: string }[];
  /** 今天的记录里一条条带日子、所属记忆文档的话题。 */
  talk: readonly { day: string; docId: string; title: string }[];
}

// 至少在这么多个不同的日子里出现过，才算「反复」。
export const TALK_MIN_DAYS = 2;

export function rankInterests(input: InterestInput): Interest[] {
  const ranked: Interest[] = [];
  const seen = new Set<string>();
  const add = (item: Interest): void => {
    const key = item.label.trim().toLocaleLowerCase();
    if (key === '' || seen.has(key)) {
      return;
    }
    seen.add(key);
    ranked.push(item);
  };
  input.explicit.forEach((label) => add({ label, why: 'explicit' }));
  input.saved.forEach((label) => add({ label, why: 'saved' }));
  input.projects.forEach((project) => add({ label: project.name, why: 'project', ref: project.id }));
  const days = new Map<string, { title: string; days: Set<string> }>();
  for (const entry of input.talk) {
    const found = days.get(entry.docId) ?? { title: entry.title, days: new Set<string>() };
    found.days.add(entry.day);
    days.set(entry.docId, found);
  }
  [...days.entries()]
    .filter(([, value]) => value.days.size >= TALK_MIN_DAYS)
    .sort((a, b) => b[1].days.size - a[1].days.size)
    .forEach(([docId, value]) => add({ label: value.title, why: 'talk', days: value.days.size, ref: docId }));
  return ranked;
}
