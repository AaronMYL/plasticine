// /v2/tool-groups: 工具组——列出每组和它现在开没开；开关一组。开关是用户确认字段（仓库规矩：只接受带设备确认的请求）：
// 由有效的本人会话确认，内部系统浏览器不能替本人设置。改了之后下一次模型请求
// 就按新的开关给工具。提交之后推 tool_group_changed。

import {
  SetToolGroupRequestSchema,
  TOOL_GROUPS,
  type ToolGroupListResponse,
  type ToolGroupResponse,
} from '../../shared/api/index.ts';
import { TOOL_GROUP_IDS, type ToolGroupId } from '../../shared/state.ts';
import { notFoundError } from './api-error.ts';
import { withCurrent } from './conflict.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { confirmedWrite } from './user-confirmation.ts';
import { toolGroupView } from './m5b-views.ts';
import { checkInput } from './validate.ts';

function groupId(context: RequestContext): ToolGroupId {
  const id = param(context, 'id');
  const known = TOOL_GROUP_IDS.find((candidate) => candidate === id);
  if (known === undefined) {
    throw notFoundError('这个工具组');
  }
  return known;
}

function viewOf(context: RequestContext, id: ToolGroupId) {
  const definition = TOOL_GROUPS.find((group) => group.id === id);
  if (definition === undefined) {
    throw notFoundError('这个工具组');
  }
  return toolGroupView(definition, context.deps.state.toolGroups.get(id));
}

/** GET /v2/tool-groups */
export function listToolGroups(context: RequestContext): Reply {
  requireAuth(context);
  const body: ToolGroupListResponse = { groups: TOOL_GROUPS.map((group) => viewOf(context, group.id)) };
  return { status: 200, body };
}

/** POST /v2/tool-groups/:id — paired user confirmation. */
export async function setToolGroup(context: RequestContext): Promise<Reply> {
  const id = groupId(context);
  const check = (value: unknown) => checkInput(SetToolGroupRequestSchema, value, '工具组开关');
  return confirmedWrite(context, check, (body, confirmation, afterCommit) => {
    const { state, hub } = context.deps;
    withCurrent(
      () => state.toolGroups.confirm(id, body.version, body.enabled, confirmation),
      () => viewOf(context, id),
      () => state.toolGroups.get(id)?.version ?? 0,
    );
    const group = viewOf(context, id);
    afterCommit(() => hub.publish({ type: 'tool_group_changed', group }));
    const response: ToolGroupResponse = { group };
    return { status: 200, body: response };
  });
}
