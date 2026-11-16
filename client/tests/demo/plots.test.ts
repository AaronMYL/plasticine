// 官网演示两组队友的剧本要和预置的假数据对得上：群组在、要交给的队友在、接着做的那几条线在、要领的任务卡在。
import { describe, expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { seedTeamScene } from '../../src/api/fake/team-scene-seed.ts';
import { seedMediaScene } from '../../src/demo/media-seed.ts';
import { DEV, MEDIA } from '../../src/demo/plots.ts';

describe('官网演示的剧本', () => {
  it('两组队友各四位，剧本里提到的人、线、任务卡都在', async () => {
    const { control } = createFakeApi({ seed: true, streamStepMs: 0 });
    const now = new Date('2026-11-15T08:00:00.000Z');
    await seedTeamScene(control, now);
    await seedMediaScene(control, now);
    const roster = await control.mates.list();
    for (const plot of [MEDIA, DEV]) {
      const group = roster.groups.find((row) => row.name === plot.group);
      expect(group?.mateIds).toHaveLength(4);
      const members = roster.mates.filter((mate) => group?.mateIds.includes(mate.id)).map((mate) => mate.name);
      expect(members).toContain(plot.first.handTo);
      expect(members).toContain(plot.second.claimer);
      expect(control.lines.find(plot.first.lineId)?.mateGroupId).toBe(group?.id);
      expect(control.lines.find(plot.second.lineId)?.mateGroupId).toBe(group?.id);
      const card = control.lines.allLines().find((line) => line.title.startsWith(plot.second.card));
      expect(card?.mateId ?? null).toBeNull();
    }
  });
});
