// 给内核的空间与订阅工具（第 6、7 条）。他说「我想创建一个空间，关于……」→ space_write；「我想要一个……周报」→
// subscription_draft 给可编辑的草案，只追问影响大的缺口，确认后 subscription_run 先出一期样刊，按反馈调，他说可以了再
// subscription_update 开定时。改一期只改这一期：把「以后都这样」写在 rule 里，由他点了才进订阅设置。

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';
import {
  SpaceListParameters,
  SpaceReadParameters,
  SpaceWriteParameters,
  SubscriptionDraftParameters,
  SubscriptionRunParameters,
  SubscriptionUpdateParameters,
} from '../../shared/space-tools.ts';
import { checkedArgs, type KernelTool, type LineScope, type ToolArgs } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { researchDraft } from './defaults.ts';
import { SubsError } from './errors.ts';
import { runSubscription, type RunPort, type RunState } from './run.ts';
import { changeSubscription, writeSpace } from './writes.ts';

export type ToolState = RunState & Pick<StateService, 'transaction' | 'dailySettings'>;

const LIST_MAX = 30;
const FALLBACK_TIME_ZONE = 'Asia/Shanghai';

export function spacePath(id: string): string {
  return `#/books/space/${encodeURIComponent(id)}`;
}

function reply(value: unknown): { content: { type: 'text'; text: string }[]; details: Record<string, never> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
}

function tool<T extends TSchema>(spec: { name: string; label: string; description: string; parameters: T;
  say: (args: ToolArgs) => string; run: (args: ReturnType<typeof checkedArgs<T>>, scope: LineScope) => unknown }):
  KernelTool {
  return {
    name: spec.name,
    say: spec.say,
    hardLine: () => null,
    create: (scope): AgentTool => ({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      async execute(_toolCallId, raw) {
        return reply(spec.run(checkedArgs(spec.parameters, raw, spec.name), scope));
      },
    }),
  };
}

function text(args: ToolArgs, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

/** issued：订阅新出了一期（样刊出来时附「开启定时」卡，sample-card.ts）。 */
export function subsTools(state: ToolState, port: () => RunPort, now: () => Date,
  issued?: (subscriptionId: string) => void): KernelTool[] {
  const timeZone = (): string => state.dailySettings.read().settings.timeZone ?? FALLBACK_TIME_ZONE;
  return [
    tool({
      name: 'space_write', label: '写空间', parameters: SpaceWriteParameters,
      say: (args) => `写空间《${text(args, 'title', '')}》`,
      description: 'Plasticine 写的东西（报告、周报、核查、整理稿、草稿）都写成空间，不写进笔记。新建省略 id；'
        + '改已有的先 space_read 再带 id 和 version。正文结构化：headline 一句结论，stats 数字卡，heading 小节（目录），'
        + 'text 正文（[^n] 标出处），chart 只能用存下来的数据并写 source、自己整理的写 basis，image 写来源。'
        + '他让改某一期时只改这一期，change 写改了什么；能长期适用的写进 rule 让他决定。',
      run: (args) => {
        const space = writeSpace(state, args, 'ai');
        if (args.id === undefined && space.subscriptionId !== null) {
          issued?.(space.subscriptionId);
        }
        return { id: space.id, version: space.version, issueNumber: space.issueNumber, link: spacePath(space.id) };
      },
    }),
    tool({
      name: 'space_read', label: '读空间', parameters: SpaceReadParameters,
      say: () => '读空间', description: '读一个空间的正文、版本和所属订阅；接着改之前先读。',
      run: ({ id }) => {
        const space = state.spaces.require(id);
        // 他删了的（在资料库「最近删除」里）：不读给模型，说清楚是删了；space_list 也不列。
        if (space.deletedAt !== null) {
          throw new SubsError('not_found', '这个空间已删除（在资料库「最近删除」里，他还原之前不能读或改）。');
        }
        return { id, title: space.title, version: space.version, subscriptionId: space.subscriptionId,
          issueNumber: space.issueNumber, edition: space.edition, doc: space.doc };
      },
    }),
    tool({
      name: 'space_list', label: '列空间', parameters: SpaceListParameters,
      say: () => '看看有哪些空间', description: '最近的空间和订阅（找要接着改的那一个）。',
      run: () => ({
        spaces: state.spaces.list({}, { limit: LIST_MAX }).map((space) => ({ id: space.id, title: space.title,
          updatedAt: space.updatedAt, subscriptionId: space.subscriptionId, issueNumber: space.issueNumber })),
        subscriptions: state.subscriptions.all().map((sub) => ({ id: sub.id, title: sub.title, kind: sub.kind,
          status: sub.status, version: sub.version })),
      }),
    }),
    tool({
      name: 'subscription_draft', label: '订阅草案', parameters: SubscriptionDraftParameters,
      say: (args) => `起草订阅《${text(args, 'title', '')}》`,
      description: '他说「我想要一个……周报」时建订阅草案（默认方向、来源、频率、结构），他能直接在界面上改。'
        + '只追问影响大的缺口（基础还是临床、专业还是科普），没定的留空。确认后用 subscription_run 先出一期样刊。',
      run: (args) => {
        const { title, ...rest } = args;
        const sub = state.subscriptions.create({ title, kind: 'research', status: 'draft', timeZone: timeZone(),
          settings: researchDraft(rest) });
        const gaps = [sub.settings.kind === 'research' && sub.settings.focus === null ? '基础还是临床' : '',
          sub.settings.kind === 'research' && sub.settings.depth === null ? '专业还是科普' : '']
          .filter((gap) => gap !== '');
        return { id: sub.id, version: sub.version, status: sub.status, gaps };
      },
    }),
    tool({
      name: 'subscription_update', label: '改订阅', parameters: SubscriptionUpdateParameters,
      say: (args) => (args['status'] === 'active' ? '开定时' : args['status'] === 'paused' ? '暂停订阅' : '改订阅设置'),
      description: '按他的反馈改订阅设置；他看过样刊、说可以了才 status=active 开定时；他要停就 paused。',
      run: ({ id, version, title, settings, status }) => {
        const current = state.subscriptions.require(id);
        const merged = settings === undefined || current.settings.kind !== 'research' ? undefined
          : { ...current.settings, ...settings };
        const sub = changeSubscription(state, id, version, { ...(title === undefined ? {} : { title }),
          ...(merged === undefined ? {} : { settings: merged }), ...(status === undefined ? {} : { status }) });
        return { id: sub.id, version: sub.version, status: sub.status };
      },
    }),
    tool({
      name: 'subscription_run', label: '现在出一期', parameters: SubscriptionRunParameters,
      say: () => '现在出一期',
      description: '现在就出一期（草案的样刊、或他要的加刊）：往这个订阅自己的后台线里放一条消息，那条线写好后会贴回来。',
      run: ({ id, edition }, scope) => {
        const { lineId } = runSubscription(state, port(), id, now(), edition ?? null, scope.lineId);
        return { lineId };
      },
    }),
  ];
}
