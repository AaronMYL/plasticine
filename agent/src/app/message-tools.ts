import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { OutboundResultSchema } from '../../shared/outbound.ts';
import { checkedArgs, type KernelTool } from '../lines/index.ts';
import type { NetworkService } from '../network/index.ts';
import type { StateService } from '../state/index.ts';

const fields = { text: Type.String({ maxLength: 8_000 }),
  attachmentIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 5, uniqueItems: true })) };
const ContactParameters = Type.Object({ ...fields, contactId: Type.String({ minLength: 1 }),
  target: Type.Optional(Type.Enum(['person', 'ai', 'mine'])),
}, { additionalProperties: false });
const GroupParameters = Type.Object({ ...fields, groupId: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

/** 参数由工具自身声明；频道、账号和对象来自已连接的网络状态，权限匹配不推测工具名。 */
export function messageTools(state: StateService, network: NetworkService): KernelTool[] {
  return [false, true].map((group): KernelTool => {
    const name = group ? 'message_group_send' : 'message_send';
    const parameters = group ? GroupParameters : ContactParameters;
    const checked = (raw: unknown) => checkedArgs(parameters, raw, name);
    const targetId = (raw: Record<string, unknown>): string => String(raw[group ? 'groupId' : 'contactId']);
    return {
      name, say: () => group ? '发一条群消息' : '给联系人发消息', hardLine: () => 'outward',
      consequence: () => '会以你的名义发出，对方会收到。', approveLabel: () => '发出',
      outbound: (raw) => {
        const args = checked(raw), id = targetId(raw), identity = state.networkIdentity.get();
        if (identity === undefined) return null;
        if (group ? state.groups.get(id)?.leftAt !== null : state.contacts.get(id)?.state !== 'active') return null;
        const attachments = state.networkAttachments.outgoing(args.attachmentIds ?? [], identity.accountId);
        return { channel: group ? 'cyberhunter.group' : 'cyberhunter.contact', account: identity.accountId,
          recipients: [id], category: 'message', content: JSON.stringify({ text: args.text,
            target: 'target' in args ? args.target ?? 'person' : 'group',
            attachments: attachments.map(({ id: attachmentId, name, sha256, bytes }) =>
              ({ id: attachmentId, name, sha256, bytes })) }) };
      },
      outboundResult: (result, failed) => {
        const value = typeof result.details === 'object' && result.details !== null
          ? Reflect.get(result.details, 'outbound') : undefined;
        return !failed && Value.Check(OutboundResultSchema, value) ? value
          : { status: 'unknown', summary: '没有收到可核对的消息发送回执。', sourceRef: null };
      },
      create: (scope) => ({ name, label: group ? '发群消息' : '给联系人发消息', parameters,
        description: group ? '以主人的名义给已加入的 Cyber Hunter 群组发送消息或消息附件。授权匹配后执行。'
          : '以主人的名义给已连接的 Cyber Hunter 联系人发送消息或消息附件。target可给本人、对方AI或自己的AI。授权匹配后执行。',
        async execute(callId, raw) {
          const args = checked(raw), id = targetId(raw as Record<string, unknown>);
          const key = createHash('sha256').update(JSON.stringify([scope.lineId, callId])).digest('hex');
          const requestId = `message-${key}`;
          const attachmentIds = args.attachmentIds ?? [];
          const row = group ? network.postToGroup(id, { text: args.text, aiOf: null, requestId, attachmentIds })
            : network.sendMessage(id, { text: args.text, requestId, attachmentIds,
              target: 'target' in args ? args.target ?? 'person' : 'person' });
          return { content: [{ type: 'text', text: '消息已进入发件箱。' }], details: {
            outbound: { status: 'queued', summary: '消息已进入发件箱。',
              sourceRef: `${group ? 'network-group-message' : 'network-message'}:${row.id}` },
          } };
        },
      }),
    };
  });
}
