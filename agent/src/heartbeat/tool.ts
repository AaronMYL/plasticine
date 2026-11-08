// 他跟 Plasticine 说一句就能改心跳的清单（《优化清单》第 11 条：「也能跟 Plasticine 说一句让它改」）：读清单、整份换掉。

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { HEARTBEAT_ITEM_MAX_CHARS, HEARTBEAT_ITEMS_MAX } from '../../shared/api/index.ts';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import type { Heartbeat } from './heartbeat.ts';

export const HeartbeatChecklistParameters = Type.Object({
  /** read：看现在的清单；set：整份换掉（顺序就是新的顺序；不在里面的删掉）。 */
  action: Type.Enum(['read', 'set']),
  items: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: HEARTBEAT_ITEM_MAX_CHARS }),
    { maxItems: HEARTBEAT_ITEMS_MAX })),
}, { additionalProperties: false });

function reply(value: unknown): { content: { type: 'text'; text: string }[]; details: Record<string, never> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
}

export function heartbeatChecklistTool(heartbeat: () => Heartbeat): KernelTool {
  return {
    name: 'heartbeat_checklist',
    say: (args) => (args['action'] === 'set' ? '改心跳的清单' : '看心跳的清单'),
    hardLine: () => null,
    lineKinds: ['main', 'side'],
    create: (): AgentTool => ({
      name: 'heartbeat_checklist',
      label: '心跳的清单',
      description: '心跳每隔一会儿替他看一眼的那张短清单。他说「心跳别再看信息流了」「心跳也看看快递」时用：先 read，'
        + '再 set 整份新的清单（保留的条目原样写，顺序照他的意思）。清单要短，一条十来个字。',
      parameters: HeartbeatChecklistParameters,
      async execute(_toolCallId, raw) {
        const args = checkedArgs(HeartbeatChecklistParameters, raw, 'heartbeat_checklist');
        const desk = heartbeat();
        if (args.action === 'read' || args.items === undefined) {
          return reply({ items: desk.config().items.map((item) => item.text) });
        }
        const current = desk.config().items;
        const view = desk.update({ items: args.items.map((text) => {
          const kept = current.find((item) => item.text === text.trim());
          return kept === undefined ? { text } : { id: kept.id, text };
        }) });
        return reply({ items: view.config.items.map((item) => item.text) });
      },
    }),
  };
}
