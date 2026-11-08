// 任务栏目的路由条目（router.ts 摊进 ROUTES）：shared/api/tasks-board.ts。都要本人会话。

import { DEVICE_TIME_ZONE_PATH, SUGGESTIONS_PATH, TASKS_BOARD_PATH, TEAMMATE_STOP_PATH, TIMED_ENABLE_PATH,
  TIMED_REMOVE_PATH } from '../../shared/api/index.ts';
import type { Route } from './context.ts';
import { dismissSuggestion, enableTimed, readTasksBoard, removeTimed, reportTimeZone, startSuggestion, stopTeammate,
  todoSuggestion } from './tasks.ts';

export const TASK_ROUTES: readonly Route[] = [
  { method: 'GET', path: TASKS_BOARD_PATH, auth: true, handler: readTasksBoard },
  { method: 'POST', path: TIMED_ENABLE_PATH, auth: true, handler: enableTimed },
  { method: 'POST', path: TIMED_REMOVE_PATH, auth: true, handler: removeTimed },
  { method: 'POST', path: TEAMMATE_STOP_PATH, auth: true, handler: stopTeammate },
  { method: 'POST', path: `${SUGGESTIONS_PATH}/:id/start`, auth: true, handler: startSuggestion },
  { method: 'POST', path: `${SUGGESTIONS_PATH}/:id/todo`, auth: true, handler: todoSuggestion },
  { method: 'POST', path: `${SUGGESTIONS_PATH}/:id/dismiss`, auth: true, handler: dismissSuggestion },
  { method: 'POST', path: DEVICE_TIME_ZONE_PATH, auth: true, handler: reportTimeZone },
];
