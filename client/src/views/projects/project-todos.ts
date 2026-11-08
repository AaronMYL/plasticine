// 项目的待办（2026-11-05 他定：原来的「关切」并进项目，成了带期限的待办）：POST / PUT /v2/projects/:id/todos。
// 没做完的在前、期限近的在前，没期限的排在有期限的后面；做完的放最后。

import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ProjectDetail, ProjectTodoView } from '../../api/shared.ts';

export function todosOf(detail: Pick<ProjectDetail, 'todos'>): ProjectTodoView[] {
  const rank = (todo: ProjectTodoView): string => `${todo.doneAt === null ? 0 : 1}${todo.due ?? '9999-99-99'}`;
  return [...detail.todos].sort((a, b) => rank(a).localeCompare(rank(b)) || a.createdAt.localeCompare(b.createdAt));
}

/** 「今天」「明天」，再远写月-日；过期的照样写月-日。 */
export function dueText(due: string, today: string): string {
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return due.slice(5);
}

export function addTodo(api: PlasticineApi, projectId: string, title: string, due: string | null): Promise<unknown> {
  return api.projects.addTodo(projectId, { requestId: createRequestId(), title, due });
}

export function setTodoDone(api: PlasticineApi, projectId: string, todo: ProjectTodoView, done: boolean)
  : Promise<unknown> {
  return api.projects.editTodo(projectId, todo.id, { requestId: createRequestId(), done });
}
