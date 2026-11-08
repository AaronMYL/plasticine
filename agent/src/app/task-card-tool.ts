// 发任务卡（2026-11-05 他定，第二个入口）：在和 Plasticine 的对话里说一句「让小林的 Plasticine 帮我整理……」，
// Plasticine 起草同一张卡。以他的名义对外发出是硬线：先出一张要你授权的卡，卡上画成任务卡的样子，他点「发出」才发
// （只放行这一次、这组参数）。发给一个好友，或一个群（指给群里某人，或全群谁先接谁做）。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { checkedArgs, type KernelTool, type ToolArgs } from '../lines/index.ts';
import type { NetworkService } from '../network/index.ts';
import type { StateService } from '../state/index.ts';

const Parameters = Type.Object({
  to: Type.String({ minLength: 1, maxLength: 64,
    description: '发给谁：好友的 @handle（不带 @ 也行），或群名' }),
  title: Type.String({ minLength: 1, maxLength: 60, description: '一句话的标题，像「帮我整理杭州周末适合带父母去的三个地方」' }),
  goal: Type.String({ minLength: 1, maxLength: 2_000, description: '要做到什么：写清楚交回来是什么样子' }),
  deadline: Type.Optional(Type.String({ description: '期限，ISO 时间；没说就不填' })),
  assignee: Type.Optional(Type.String({ description: '发到群里时指给谁（成员的 @handle）；不填 = 全群谁先接谁做' })),
  noteId: Type.Optional(Type.String({ description: '要附上的资料：一篇笔记的 id（发过去的是它的正文）' })),
}, { additionalProperties: false });

type Target = { kind: 'contact'; id: string; name: string; avatar: string | null }
  | { kind: 'group'; id: string; name: string; avatar: string | null };

const ATTACHMENT_MAX_CHARS = 20_000;

function text(args: ToolArgs, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function target(state: StateService, to: string): Target | null {
  const handle = to.replace(/^@/, '').toLowerCase();
  const contact = state.contacts.all().find((entry) => entry.state === 'active'
    && (entry.handle === handle || entry.displayName === to));
  if (contact !== undefined) {
    return { kind: 'contact', id: contact.id, name: contact.displayName, avatar: contact.avatar };
  }
  const group = state.groups.active().find((entry) => entry.name === to || entry.id === to);
  return group === undefined ? null : { kind: 'group', id: group.id, name: group.name, avatar: group.avatar };
}

function assigneeOf(state: StateService, groupId: string, handle: string | null): string | null {
  if (handle === null) {
    return null;
  }
  const bare = handle.replace(/^@/, '').toLowerCase();
  return state.groupMembers.current(groupId).find((member) => member.handle === bare
    || member.displayName === handle)?.accountId ?? null;
}

function create(state: StateService, network: NetworkService): AgentTool<typeof Parameters> {
  return {
    name: 'send_task_card',
    label: '发任务卡',
    description: '以他的名义给 Cyber Hunter 上的好友（或一个群）发一张任务卡：对方点「让 Plasticine 做」或「我来做」，'
      + '做完交回给他。这是硬线：调用前会先问他，他点「发出」才真的发出去。只在他明确要你把一件事交给某个人时用。',
    parameters: Parameters,
    async execute(toolCallId, raw) {
      const args = checkedArgs(Parameters, raw, 'send_task_card');
      const found = target(state, args.to);
      if (found === null) {
        throw new Error(`找不到「${args.to}」：要是互加了的好友的 @handle，或者群名。`);
      }
      const note = args.noteId === undefined ? undefined : state.notes.get(args.noteId);
      const attachment = note === undefined || note.private ? null
        : `${note.title}\n\n${state.notes.readBody(note)}`.slice(0, ATTACHMENT_MAX_CHARS);
      const requestId = `card-${toolCallId}`.slice(0, 100);
      if (found.kind === 'group') {
        network.offerGroupTask(found.id, { title: args.title, goal: args.goal, deadline: args.deadline ?? null,
          attachment, assignee: assigneeOf(state, found.id, args.assignee ?? null), requestId });
      } else {
        network.offerTask(found.id, { title: args.title, goal: args.goal, acceptance: null,
          deadline: args.deadline ?? null, attachment, requestId });
      }
      return { content: [{ type: 'text', text: `任务卡发给${found.name}了，等对方点头。` }], details: {} };
    },
  };
}

/** 发任务卡这件工具：硬线（以他的名义发出），卡上按任务卡画。 */
export function taskCardTool(state: StateService, network: NetworkService): KernelTool {
  return {
    name: 'send_task_card',
    say: (args) => `把任务卡发给${text(args, 'to') ?? '对方'}`,
    hardLine: () => 'outward',
    approveLabel: () => '发出',
    consequence: (args) => {
      const found = target(state, text(args, 'to') ?? '');
      return `发出后${found?.name ?? '对方'}会收到`;
    },
    preview: (args) => {
      const found = target(state, text(args, 'to') ?? '');
      const noteId = text(args, 'noteId');
      const note = noteId === null ? undefined : state.notes.get(noteId);
      const assignee = found?.kind === 'group' ? assigneeOf(state, found.id, text(args, 'assignee')) : null;
      return {
        to: { name: found?.name ?? text(args, 'to') ?? '', avatar: found?.avatar ?? null,
          group: found?.kind === 'group' },
        assignee: assignee === null ? null : state.groupMembers.get(found?.id ?? '', assignee)?.displayName ?? null,
        title: text(args, 'title') ?? '',
        goal: text(args, 'goal') ?? '',
        deadline: text(args, 'deadline'),
        attachment: note === undefined ? null : note.title,
      };
    },
    create: () => create(state, network),
  };
}
