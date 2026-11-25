import type { CSSProperties, ReactNode } from 'react';
import type { HomeCardKind, ProjectHue, ProjectTag } from '../api/shared.ts';
import { Icon, type IconName } from './icons.tsx';
import './hue.css';

export type HueName = ProjectHue | 'clay' | 'sage' | 'err' | 'ink';

export const HUE_NAMES: Readonly<Record<ProjectHue, string>> = {
  ochre: '赭黄', teal: '青绿', sky: '天蓝', rose: '玫红', olive: '橄榄', slate: '石板', plum: '梅紫', indigo: '靛蓝',
};

export const KIND_STYLE: Readonly<Record<HomeCardKind, { hue: HueName; icon: IconName }>> = {
  decide: { hue: 'clay', icon: 'check' },
  reauth: { hue: 'err', icon: 'lock' },
  task_failing: { hue: 'err', icon: 'refresh' },
  task: { hue: 'slate', icon: 'tasks' },
  project: { hue: 'slate', icon: 'folder' },
  book: { hue: 'ochre', icon: 'books' },
  note: { hue: 'teal', icon: 'notes' },
  feed: { hue: 'sky', icon: 'feed' },
  calendar: { hue: 'rose', icon: 'today' },
  money: { hue: 'olive', icon: 'wallet' },
  focus: { hue: 'sage', icon: 'timer' },
  matter: { hue: 'slate', icon: 'thread' },
  web: { hue: 'ink', icon: 'globe' },
  observe: { hue: 'ink', icon: 'sparkle' },
  trial: { hue: 'sage', icon: 'sparkles' },
  change: { hue: 'ink', icon: 'history' },
};

export function cardHue(kind: HomeCardKind, project: ProjectTag | null): HueName {
  if ((kind === 'project' || kind === 'matter') && project !== null) {
    return project.hue;
  }
  return KIND_STYLE[kind].hue;
}

export function hueVar(hue: HueName): string {
  return `var(--hue-${hue})`;
}

export function HueTile({ hue, icon, size = 28 }: { hue: HueName; icon: IconName; size?: number }): ReactNode {
  return (
    <span className="hue-tile" style={{ '--tile-hue': hueVar(hue), width: size, height: size } as CSSProperties}
      aria-hidden="true">
      <Icon name={icon} size={size >= 32 ? 17 : 15} />
    </span>
  );
}

export function ProjectMark({ project }: { project: ProjectTag }): ReactNode {
  return (
    <span className="project-mark text-meta">
      <span className="project-dot" style={{ background: hueVar(project.hue) }} aria-hidden="true" />
      {project.name}
    </span>
  );
}
