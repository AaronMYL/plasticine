export type InterestWhy = 'explicit' | 'saved' | 'project' | 'talk';

export interface Interest {
  label: string;
  why: InterestWhy;
  days?: number;
  ref?: string;
}

export interface InterestInput {
  explicit: readonly string[];
  saved: readonly string[];
  projects: readonly { id: string; name: string }[];
  talk: readonly { day: string; docId: string; title: string }[];
}

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
