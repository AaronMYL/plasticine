import type { PlasticineApi } from '../../api/client.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { ProjectDetail, ProjectTodoView } from '../../api/shared.ts';

export function todosOf(detail: Pick<ProjectDetail, 'todos'>): ProjectTodoView[] {
  const rank = (todo: ProjectTodoView): string => `${todo.doneAt === null ? 0 : 1}${todo.due ?? '9999-99-99'}`;
  return [...detail.todos].sort((a, b) => rank(a).localeCompare(rank(b)) || a.createdAt.localeCompare(b.createdAt));
}

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
