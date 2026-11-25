import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { NOW } from '../helpers.tsx';

function seeded(): ReturnType<typeof createFakeApi> {
  return createFakeApi({ seed: true, streamStepMs: 0, now: () => NOW });
}

describe('Memory topics', () => {
  it('Catalog groups 6 categories; lines show source; resolved uncertain leaves list',
    async () => {
      const fake = seeded();
      const list = await fake.api.memoryTopics.list();
      expect(list.groups.map((group) => group.kind)).toEqual(['grants', 'about_you', 'person', 'project', 'topic',
        'how']);
      expect(list.groups[0]?.topics.map((topic) => [topic.title, topic.summary])).toEqual([
        ['承诺和授权', '可以直接做 3 · 先问你 3 · 先停着 1 · 答应你的 2'],
        ['主动告诉你', '每 30 分钟看 7 件事 · 23:00–08:00 不打扰']]);
      const doc = await fake.api.memoryTopics.get('t_you');
      expect(doc.sections.flatMap((section) => section.lines).every((line) => line.sources.length > 0)).toBe(true);
      const item = list.uncertain[0]!;
      const target = { kind: 'memory_uncertain', uncertainId: item.id } as const;
      const bodyText = JSON.stringify({ requestId: 'req_uncertain_1', answer: 'yes', correction: null });
      const result = await fake.api.signed.send({ target, bodyText });
      expect(result).toMatchObject({ kind: 'memory_uncertain', item: { id: item.id, status: 'confirmed' } });
      const after = await fake.api.memoryTopics.list();
      expect(after.uncertain.some((open) => open.id === item.id)).toBe(false);
      const lines = (await fake.api.memoryTopics.get(item.topicId)).sections.flatMap((section) => section.lines);
      expect(lines.some((line) => line.uncertainId === item.id)).toBe(false);
    });
});
