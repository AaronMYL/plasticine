// 给内核的空间与订阅工具（第 6、7 条；第 8 批第 6 条起空间是整页网页）。他说「我想创建一个空间，关于……」→
// space_write 写一页报告；改已有的一页用 space_edit（找原文 → 换新文）或 space_write 整页重写。「我想要一个……周报」→
// subscription_draft 给可编辑的草案，只追问影响大的缺口，确认后 subscription_run 先出一期样刊，按反馈调，他说可以了再
// subscription_update 开定时。改一期只改这一期：把「以后都这样」写在 rule 里，由他点了才进订阅设置。
// 来信（个人回顾的日报、周报）写好后在主线发一句、带来信卡（lettered）；信里的插图占位先画好再存（illustrate.ts）。

import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';
import type { Space } from '../../shared/state.ts';
import { productLink } from '../../shared/product-links.ts';
import {
  SpaceEditParameters,
  SpaceListParameters,
  SpaceReadParameters,
  SpaceWriteParameters,
  SubscriptionDraftParameters,
  SubscriptionRunParameters,
  SubscriptionUpdateParameters,
} from '../../shared/space-tools.ts';
import type { IllustrationMime, Illustrator } from '../kernel/index.ts';
import { checkedArgs, type KernelTool, type LineScope, type ToolArgs } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { researchDraft } from './defaults.ts';
import { SubsError } from './errors.ts';
import { illustrate, type Illustrated } from './illustrate.ts';
import { reportTooPlain } from './page-richness.ts';
import { runSubscription, type RunPort, type RunState } from './run.ts';
import { LETTER_GUIDE, REPORT_GUIDE, SPACE_RULES } from './space-guide.ts';
import { changeSubscription, editSpace, writeSpace, type SpaceWritten } from './writes.ts';

export type ToolState = RunState & Pick<StateService, 'transaction' | 'dailySettings' | 'notes'>;

/** 网页版空间的几处外接：出图、存插图、来信写好后在主线说一句。 */
export interface SpacePageHooks {
  illustrator?: Illustrator | null;
  /** 存成资产、回资产名；不给就存进笔记的图片目录。 */
  saveAsset?: (data: Buffer, mime: IllustrationMime) => string;
  /** 新的一封来信写好了：在主线发 say 那一句，带来信卡。 */
  lettered?: (space: Space, say: string) => void;
}

const LIST_MAX = 30;
const FALLBACK_TIME_ZONE = 'Asia/Shanghai';

export function spacePath(id: string): string {
  return productLink('space', id);
}

function reply(value: unknown): { content: { type: 'text'; text: string }[]; details: Record<string, never> } {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], details: {} };
}

function tool<T extends TSchema>(spec: { name: string; label: string; description: string; parameters: T;
  say: (args: ToolArgs) => string;
  run: (args: ReturnType<typeof checkedArgs<T>>, scope: LineScope, signal: AbortSignal) => unknown }): KernelTool {
  return {
    name: spec.name,
    say: spec.say,
    hardLine: () => null,
    create: (scope): AgentTool => ({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      parameters: spec.parameters,
      async execute(_toolCallId, raw, signal) {
        return reply(await spec.run(checkedArgs(spec.parameters, raw, spec.name), scope,
          signal ?? new AbortController().signal));
      },
    }),
  };
}

function text(args: ToolArgs, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function written(result: SpaceWritten, art: Illustrated['outcome']): Record<string, unknown> {
  const { space, removed } = result;
  return { id: space.id, title: space.title, version: space.version, genre: space.genre, issueNumber: space.issueNumber,
    link: spacePath(space.id), ...(removed.length === 0 ? {} : { removed }),
    ...(art === null ? {} : 'asset' in art ? { illustration: '配好了' } : { illustration: `没配：${art.skipped}` }) };
}

const WRITE_DESCRIPTION = 'Plasticine 写的东西（报告、周报、核查、整理稿、草稿）都写成空间（整页网页），不写进笔记。'
  + '新建省略 id；改已有的先 space_read 再带 id 和 version（小改用 space_edit）。他让改某一期时只改这一期，change 写改了'
  + `什么；能长期适用的写进 rule 让他决定。\n${SPACE_RULES}\n${REPORT_GUIDE}\n${LETTER_GUIDE}`;

/** issued：订阅新出了一期（样刊出来时附「开启定时」卡，sample-card.ts）。 */
export function subsTools(state: ToolState, port: () => RunPort, now: () => Date,
  issued?: (subscriptionId: string) => void, pages: SpacePageHooks = {}): KernelTool[] {
  const timeZone = (): string => state.dailySettings.read().settings.timeZone ?? FALLBACK_TIME_ZONE;
  /** 这次进程里退回过一次的页（线 + 标题）：第二次交照收。 */
  const bounced = new Set<string>();
  const saveAsset = pages.saveAsset
    ?? ((data: Buffer, mime: IllustrationMime) => state.notes.writeAsset(data, mime).name);
  return [
    tool({
      name: 'space_write', label: '写空间', parameters: SpaceWriteParameters,
      say: (args) => `写空间《${text(args, 'title', '')}》`,
      description: WRITE_DESCRIPTION,
      run: async (args, scope, signal) => {
        // 长报告写成一屏屏段落的，退回去重排一次（page-richness.ts）；同一页第二次交照收。
        const plainKey = `${scope.lineId}:${args.id ?? args.title}`;
        const before = args.id === undefined ? undefined : state.spaces.get(args.id);
        const plain = (args.genre ?? before?.genre) === 'report'
          && (args.category ?? before?.category) !== 'webarchive' && !bounced.has(plainKey)
          ? reportTooPlain(args.html) : null;
        if (plain !== null) {
          bounced.add(plainKey);
          throw new SubsError('invalid', plain);
        }
        const art = args.genre === 'letter'
          ? await illustrate(args.html, { illustrator: pages.illustrator ?? null, save: saveAsset, signal })
          : { html: args.html, outcome: null };
        const result = writeSpace(state, { ...args, html: art.html, lineId: scope.lineId }, 'ai');
        const { space } = result;
        if (args.id === undefined && space.subscriptionId !== null) {
          issued?.(space.subscriptionId);
        }
        if (args.id === undefined && space.genre === 'letter') {
          pages.lettered?.(space, args.say ?? `给你写了一封信：《${space.title}》。`);
        }
        return { ...written(result, art.outcome), change: args.change ?? '写好了正文' };
      },
    }),
    tool({
      name: 'space_edit', label: '改空间', parameters: SpaceEditParameters,
      say: () => '改空间',
      description: '小改一页空间：先 space_read 拿到 html 和 version，每条 old_text 从当前 html 里原样照抄（含标签），'
        + '在全文里只能出现一次，换成 new_text；按顺序换，有一条对不上就整个不改。大改用 space_write 整页重写。',
      run: ({ id, version, edits, change, rule }, scope) => ({ ...written(editSpace(state, { id, version,
        lineId: scope.lineId,
        edits: edits.map((edit) => ({ oldText: edit.old_text, newText: edit.new_text })),
        ...(change === undefined ? {} : { change }), ...(rule === undefined ? {} : { rule }) }, 'ai'), null),
        change: change ?? `改了 ${edits.length} 处` }),
    }),
    tool({
      name: 'space_read', label: '读空间', parameters: SpaceReadParameters,
      say: () => '读空间', description: '读一个空间的网页正文（html）、体裁、版本和所属订阅；接着改之前先读。'
        + '还没重写成网页的旧空间 html 是 null，给的是旧版的结构化正文 doc。',
      run: ({ id }) => {
        const space = state.spaces.require(id);
        // 他删了的（在资料库「最近删除」里）：不读给模型，说清楚是删了；space_list 也不列。
        if (space.deletedAt !== null) {
          throw new SubsError('not_found', '这个空间已删除（在资料库「最近删除」里，他还原之前不能读或改）。');
        }
        return { id, title: space.title, version: space.version, genre: space.genre,
          subscriptionId: space.subscriptionId, issueNumber: space.issueNumber, edition: space.edition,
          html: space.html, ...(space.html === null ? { doc: space.doc } : {}) };
      },
    }),
    tool({
      name: 'space_list', label: '列空间', parameters: SpaceListParameters,
      say: () => '看看有哪些空间', description: '最近的空间和订阅（找要接着改的那一个）。',
      run: () => ({
        spaces: state.spaces.list({}, { limit: LIST_MAX }).map((space) => ({ id: space.id, title: space.title,
          genre: space.genre, updatedAt: space.updatedAt, subscriptionId: space.subscriptionId,
          issueNumber: space.issueNumber })),
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
