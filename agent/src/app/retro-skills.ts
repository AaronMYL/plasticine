// 事后复盘看到和写的技能（内核优化第二批）：目录、读一份 SKILL.md、写回。随程序带的只能读。

import type { RetroSkills } from '../memory/index.ts';
import type { SkillStore } from '../skills/index.ts';

export function retroSkills(skills: SkillStore): RetroSkills {
  return {
    list: () => skills.search().skills.map((skill) => ({ name: skill.name, description: skill.description,
      version: skill.version, editable: skill.source.kind !== 'builtin' })),
    body: (name) => {
      try {
        return skills.read({ name }, null).text;
      } catch {
        return null;
      }
    },
    write: (name, content, expectedVersion, actionId) => {
      skills.write({ name, content, expectedVersion }, { actionId, runId: actionId, taskId: null });
    },
  };
}
