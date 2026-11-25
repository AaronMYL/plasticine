import { PROJECT_HUES, STANDING_PROJECT_IDS, type ProjectHue, type ProjectTag } from '../shared.ts';

export const DESIGN_PROJECTS = {
  hunter: { id: 'project_hunter', name: 'Cyber Hunter', hue: 'rose' },
  plasticine: { id: STANDING_PROJECT_IDS.plasticine, name: 'Plasticine', hue: 'teal' },
  personal: { id: STANDING_PROJECT_IDS.personal, name: '个人', hue: 'ochre' },
  handover: { id: 'project_handover', name: '资料交接（示例）', hue: 'sky' },
} as const satisfies Record<string, ProjectTag>;

export function designHue(projectId: string): ProjectHue {
  const known = Object.values(DESIGN_PROJECTS).find((project) => project.id === projectId);
  if (known !== undefined) {
    return known.hue;
  }
  const sum = Array.from(projectId).reduce((total, char) => total + (char.codePointAt(0) ?? 0), 0);
  return PROJECT_HUES[sum % PROJECT_HUES.length]!;
}

const MINUTE_MS = 60_000;

export function minutesAgo(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * MINUTE_MS).toISOString();
}
