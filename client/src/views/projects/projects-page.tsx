// 项目页（用户 2026-11-01 定：项目取代关切成为界面上的组织单位）：#/projects 是列表，#/projects/<id> 是一个项目。

import type { ReactNode } from 'react';
import type { Route } from '../../shell/routes.ts';
import { ProjectDetailPage } from './project-detail.tsx';
import { PhoneProject } from './phone-project.tsx';
import { ProjectList } from './project-list.tsx';
import './projects.css';

export function ProjectsPage({ projectId, navigate, phone = false, onBack }: {
  projectId: string | null; navigate: (route: Route) => void; phone?: boolean; onBack?: (() => void) | undefined;
}): ReactNode {
  if (projectId === null) {
    return <ProjectList navigate={navigate} />;
  }
  if (phone) return <PhoneProject projectId={projectId} navigate={navigate} onBack={onBack} />;
  return <ProjectDetailPage projectId={projectId} navigate={navigate} />;
}
