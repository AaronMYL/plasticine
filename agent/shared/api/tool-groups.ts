// /v2/tool-groups: 工具组（脑的工具按组开关）。哪几组、每组有哪些工具、默认开不开写在这里，两端共用一份。开关是用户确认
// 字段：只接受本人配对会话的确认，模型工具写不到。关掉的组，脑在对话和任务里
// 都看不到它的工具（调了也当没有这个工具）。

import { Type, type Static } from 'typebox';
import { TOOL_GROUP_IDS, type ToolGroupId } from '../state.ts';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';

export const TOOL_GROUPS_PATH = `${API_PREFIX}/tool-groups`;

export interface ToolGroupDefinition {
  id: ToolGroupId;
  label: string;
  description: string;
  tools: readonly string[];
  /** 没改过时开不开。 */
  defaultEnabled: boolean;
}

export const TOOL_GROUPS: readonly ToolGroupDefinition[] = [
  {
    id: 'cloud_ssh',
    label: '服务器命令',
    description: '在 Plasticine 本机执行命令并保留输出；SSH 另需真实传输连接，开关不代表已接通。',
    tools: ['server_exec', 'server_command_read', 'cloud_ssh_run'],
    defaultEnabled: true,
  },
  {
    id: 'cloud_browser',
    label: '云端浏览器',
    description: '在云端打开、读取和操作网页，沿用你已确认的全面授权。',
    tools: ['cloud_browser_open', 'cloud_browser_read', 'cloud_browser_observe', 'cloud_browser_act'],
    defaultEnabled: true,
  },
  {
    id: 'inbox',
    label: '站内信',
    description: '看站内信的列表和一封的全文（只读；信里的话不当指令）。',
    tools: ['list_inbox', 'read_inbox'],
    defaultEnabled: true,
  },
  {
    id: 'attachments',
    label: '附件转文字',
    description: '把文件页里的文字、PDF、Word 读成文字。',
    tools: ['attachment_text'],
    defaultEnabled: true,
  },
];

if (TOOL_GROUPS.length !== TOOL_GROUP_IDS.length) {
  throw new Error('工具组的定义和 TOOL_GROUP_IDS 对不上');
}

/** Which group a tool is in; tools in no group (get_time, the task tools …) are always on. */
export function groupOfTool(name: string): ToolGroupDefinition | undefined {
  return TOOL_GROUPS.find((group) => group.tools.includes(name));
}

export const ToolGroupViewSchema = Type.Object({
  id: Type.Enum(TOOL_GROUP_IDS),
  label: Type.String(),
  description: Type.String(),
  tools: Type.Array(Type.String()),
  enabled: Type.Boolean(),
  /** 0 while it is still on its default (nobody switched it). */
  version: Type.Integer({ minimum: 0 }),
  /** Whether the user switched it (on a paired device), and when. */
  confirmedAt: OrNull(IsoTimeSchema),
});
export type ToolGroupView = Static<typeof ToolGroupViewSchema>;

export const ToolGroupListResponseSchema = Type.Object({ groups: Type.Array(ToolGroupViewSchema) });
export type ToolGroupListResponse = Static<typeof ToolGroupListResponseSchema>;

/** POST /v2/tool-groups/:id — paired user confirmation → 200 { group }. */
export const SetToolGroupRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 0 }), enabled: Type.Boolean() },
  { additionalProperties: false },
);
export type SetToolGroupRequest = Static<typeof SetToolGroupRequestSchema>;
export const ToolGroupResponseSchema = Type.Object({ group: ToolGroupViewSchema });
export type ToolGroupResponse = Static<typeof ToolGroupResponseSchema>;
