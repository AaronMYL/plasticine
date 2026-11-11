import { createHash } from 'node:crypto';
import { SendLineMessageRequestSchema } from '../../shared/api/lines.ts';
import { MATE_GROUPS_PATH } from '../../shared/api/mates.ts';
import { MateGroupTasks } from '../mates/group-tasks.ts';
import { ApiError } from './api-error.ts';
import { param, requireAuth, requireUserAuth, type Route } from './context.ts';
import { readJsonBody } from './http.ts';
import { idempotent } from './idempotency.ts';
import { lineCall } from './lines.ts';
import { checkInput } from './validate.ts';

export const MATE_GROUP_TASK_ROUTES: readonly Route[] = [
  { method: 'GET', path: `${MATE_GROUPS_PATH}/:id/tasks`, auth: true, handler(context) {
    requireAuth(context);
    const tasks = new MateGroupTasks(context.deps.state, () => context.deps.lines);
    return { status: 200, body: { lines: lineCall(() => tasks.list(param(context, 'id'))) } };
  } },
  { method: 'POST', path: `${MATE_GROUPS_PATH}/:id/tasks`, auth: true, async handler(context) {
    requireUserAuth(context);
    const input = checkInput(SendLineMessageRequestSchema, await readJsonBody(context.req), '群任务');
    // 复用发消息输入，但发布任务没有回复/摘录语义，不能静默丢掉调用者带来的内容。
    if (input.replyTo !== undefined || (input.quotes?.length ?? 0) > 0) {
      throw new ApiError(400, 'invalid_request', '请把任务目标写在正文中再发布。');
    }
    const groupId = param(context, 'id');
    const tasks = new MateGroupTasks(context.deps.state, () => context.deps.lines);
    return idempotent(context, input.requestId, (after) => ({ status: 201, body: { line: lineCall(() => {
      const group = context.deps.state.mateGroups.require(groupId);
      return tasks.offer({ groupId, sourceLineId: group.lineId, goal: input.text, offerKey: input.requestId,
        user: true, attachments: input.attachments ?? [] }, after);
    }) } }), { bodyDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex') });
  } },
];
