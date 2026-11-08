// 设计稿（2026-11-02）里项目的颜色：项目表还没有颜色这一列，假接口按项目 id 固定配一种（真接口下一批加列）。
// id 和 daily-seed.ts 里预置的四个项目对得上，点首页卡、事、记忆主题上的项目能到同一个项目页。

import { PROJECT_HUES, STANDING_PROJECT_IDS, type ProjectHue, type ProjectTag } from '../shared.ts';

export const DESIGN_PROJECTS = {
  hunter: { id: 'project_hunter', name: 'Cyber Hunter', hue: 'rose' },
  plasticine: { id: STANDING_PROJECT_IDS.plasticine, name: 'Plasticine', hue: 'teal' },
  personal: { id: STANDING_PROJECT_IDS.personal, name: '个人', hue: 'ochre' },
  handover: { id: 'project_handover', name: '资料交接（示例）', hue: 'sky' },
} as const satisfies Record<string, ProjectTag>;

/** 假项目的颜色：设计稿里那几个照稿子，别的按 id 固定配一档（真服务端按 id 的摘要配，见 matter-views.ts）。 */
export function designHue(projectId: string): ProjectHue {
  const known = Object.values(DESIGN_PROJECTS).find((project) => project.id === projectId);
  if (known !== undefined) {
    return known.hue;
  }
  const sum = Array.from(projectId).reduce((total, char) => total + (char.codePointAt(0) ?? 0), 0);
  return PROJECT_HUES[sum % PROJECT_HUES.length]!;
}

const MINUTE_MS = 60_000;

/** 现在往前 n 分钟，ISO 字符串。 */
export function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * MINUTE_MS).toISOString();
}
