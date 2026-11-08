// 项目色和项目小标签（第 104 条）：色从项目 id 的散列取，书签分节、标签分组、记忆主题、线卡片上的色点都用它。

import { createHash } from 'node:crypto';
import { PROJECT_HUES, type ProjectTag } from '../../shared/api/index.ts';
import type { StateService } from '../state/index.ts';

export function projectHue(projectId: string): ProjectTag['hue'] {
  const index = createHash('sha256').update(projectId).digest()[0]! % PROJECT_HUES.length;
  return PROJECT_HUES[index]!;
}

export function projectTag(state: Pick<StateService, 'projects'>, projectId: string | null): ProjectTag | null {
  const project = projectId === null ? undefined : state.projects.get(projectId);
  if (project === undefined) {
    return null;
  }
  return { id: project.id, name: project.name, hue: projectHue(project.id) };
}
