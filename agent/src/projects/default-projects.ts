// 项目的默认数据（用户 2026-11-01 定：常驻 Plasticine、个人两个项目）。启动时跑：两个常驻项目没有就建（固定 id，只建
// 一次）。原来这里还把关切归进项目；2026-11-05 关切整个并进项目成了待办（迁移 0059），这一步就没有了。

import { STANDING_PROJECT_IDS } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

type ProjectState = Pick<StateService, 'projects' | 'transaction'>;

const STANDING = [
  {
    id: STANDING_PROJECT_IDS.plasticine,
    name: 'Plasticine',
    goal: 'Plasticine 自己：和他怎么合作，用下来哪里顺手、哪里不好用。',
  },
  {
    id: STANDING_PROJECT_IDS.personal,
    name: '个人',
    goal: '不属于别的项目的个人目标、习惯与承诺、兴趣关注点。',
  },
] as const;

/** 建了常驻项目就返回 true。 */
export function ensureDefaultProjects(state: ProjectState): boolean {
  return state.transaction(() => {
    let created = false;
    for (const spec of STANDING) {
      if (state.projects.get(spec.id) !== undefined) {
        continue;
      }
      const brief = { goal: spec.goal, constraints: '', rules: '', terms: '' };
      state.projects.create({ name: spec.name, standing: true, brief }, { id: spec.id });
      state.projects.events.add({ projectId: spec.id, kind: 'created', text: '常驻项目', actor: 'system' });
      created = true;
    }
    return created;
  });
}
