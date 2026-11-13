// 给模型用的任务栏目工具（《优化清单》第 3、4 条）：
// - schedule_propose 起草定时卡：他说「每周一早上帮我……」，Plasticine 起草一张卡（做什么、什么时候、归哪个项目、结果放哪；
//   以他名义发出的写清对谁、发什么），出一张要你定卡在对话里，他点确认才生效；确认结果作为这次工具的结果回到线里。
//   改一张也走它（replacesId），改了要他再确认一次。
// - schedule_list / schedule_change：看有哪些、停 / 开 / 删（以他名义发出的卡，打开要他自己拨开关）。
// - schedule_send 照卡放行：定时线里点发送被设备拦下后调，核过在卡的范围里才放行（send-permit.ts）。
// - suggest 提一条建议：他点了才开始。

import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ScheduleCadenceSchema, ScheduleOutwardSchema, SCHEDULE_GOAL_MAX_CHARS, SCHEDULE_LABEL_MAX_CHARS,
  SCHEDULE_REPORTS, SCHEDULE_TITLE_MAX_CHARS, STANDING_PROJECT_IDS, SUGGESTION_ICONS, SUGGESTION_TITLE_MAX_CHARS,
  SUGGESTION_WHY_MAX_CHARS, type Schedule } from '../../shared/state.ts';
import { answerSentence, awaitAnswer, checkedArgs, QUESTION_PURPOSE, type AskToolHost, type KernelTool,
  type LineScope } from '../lines/index.ts';
import type { StateService } from '../state/index.ts';
import { cadenceLabel } from './cadence.ts';
import { scheduleCard } from './schedule-rows.ts';
import type { ScheduleDesk } from './schedules.ts';
import { grantSend } from './send-permit.ts';
import type { SuggestionDesk } from './suggestions.ts';
import { canManageSchedule } from './schedule-owner.ts';

export const SCHEDULE_CARD_CONTEXT_KEY = 'schedule';
const CONFIRM = 'confirm';
const REVISE = 'revise';
const LIST_MAX = 50;

const ProposeParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SCHEDULE_TITLE_MAX_CHARS, description: 'Short Chinese title' }),
  goal: Type.String({ minLength: 1, maxLength: SCHEDULE_GOAL_MAX_CHARS,
    description: 'What to do at each run, complete enough to work alone; what counts as done' }),
  cadence: ScheduleCadenceSchema,
  projectId: Type.Optional(Type.String({ minLength: 1, description: 'The project it belongs to; omit for 个人' })),
  report: Type.Optional(Type.Enum(SCHEDULE_REPORTS,
    { description: 'always: tell him after every run; failures: only when it did not happen (default)' })),
  place: Type.Optional(Type.String({ minLength: 1, maxLength: SCHEDULE_LABEL_MAX_CHARS,
    description: 'Where it runs, as shown on the card, e.g. 你的 Mac（不在线就等上线补发）' })),
  outward: Type.Optional(ScheduleOutwardSchema),
  replacesId: Type.Optional(Type.String({ minLength: 1, description: 'The schedule this one changes' })),
}, { additionalProperties: false });

const ListParameters = Type.Object({}, { additionalProperties: false });

const ChangeParameters = Type.Object({
  scheduleId: Type.String({ minLength: 1 }),
  action: Type.Enum(['pause', 'resume', 'remove']),
}, { additionalProperties: false });

const SendParameters = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  tabId: Type.String({ minLength: 1, maxLength: 100 }),
  version: Type.String({ minLength: 1, maxLength: 40,
    description: 'The page version of the tab_act that came back submit_needs_you' }),
  recipient: Type.String({ minLength: 1, maxLength: 40, description: 'Exactly as written on the card' }),
  content: Type.String({ minLength: 1, maxLength: 200, description: 'What is being sent, exactly' }),
}, { additionalProperties: false });

const SuggestParameters = Type.Object({
  title: Type.String({ minLength: 1, maxLength: SUGGESTION_TITLE_MAX_CHARS, description: 'What to do, one line' }),
  why: Type.String({ minLength: 1, maxLength: SUGGESTION_WHY_MAX_CHARS, description: 'Why now, one sentence' }),
  goal: Type.String({ minLength: 1, maxLength: SCHEDULE_GOAL_MAX_CHARS,
    description: 'What a background line should do if he clicks 开始做' }),
  projectId: Type.Optional(Type.String({ minLength: 1 })),
  icon: Type.Optional(Type.Enum(SUGGESTION_ICONS)),
  key: Type.Optional(Type.String({ minLength: 1, maxLength: 200,
    description: 'Stable key so the same suggestion is never offered twice' })),
  topic: Type.Optional(Type.String({ minLength: 1, maxLength: 16,
    description: '这类建议的叫法，2–8 个字，同一类每次用同一个词（他常忽略的那类会先不出）' })),
}, { additionalProperties: false });

export interface TaskToolParts {
  state: StateService;
  schedules: ScheduleDesk;
  suggestions: SuggestionDesk;
}

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function brief(schedule: Schedule, timeZone: string): Record<string, unknown> {
  const next = schedule.nextAt === null ? null : new Date(schedule.nextAt).toLocaleString('zh-CN', { timeZone,
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { id: schedule.id, title: schedule.title, when: cadenceLabel(schedule.cadence), status: schedule.status,
    next, projectId: schedule.projectId, lastOutcome: schedule.lastOutcome, lastNote: schedule.lastNote,
    outward: schedule.outward === null ? null : { recipients: schedule.outward.recipients,
      what: schedule.outward.contentLabel, site: schedule.outward.site } };
}

function confirmLabel(schedule: Schedule): string {
  const often = schedule.cadence.type === 'daily' ? '每天' : schedule.cadence.type === 'weekly' ? '每周' : '';
  return schedule.outward === null ? '确认' : `确认，${often}照做`;
}

function consequence(schedule: Schedule): string | null {
  const outward = schedule.outward;
  if (outward === null) {
    return null;
  }
  const often = schedule.cadence.type === 'daily' ? '每天' : '到点';
  return `确认后，${often}会以你的名义发出。只发给这 ${outward.recipients.length} 位、${outward.contentLabel}；`
    + '超出这张卡的，照旧先问你。';
}

function proposeTool(parts: TaskToolParts, host: AskToolHost, scope: LineScope)
  : AgentTool<typeof ProposeParameters> {
  const { state, schedules } = parts;
  return {
    name: 'schedule_propose',
    label: '起草定时卡',
    description: '他要 Plasticine 到点替他做一件事（「每周一早上帮我……」「每天 15:00 给这几位发……」）时用：起草一张定时卡，'
      + '对话里出卡等他确认，确认了才生效（他的回答就是这次的结果）。以他名义对外、对象和内容固定的定时发送填 outward：'
      + '对谁（名单）、在哪个网站、发什么（content 只能是纯表情或几条固定的话），确认一次以后每次照卡做。'
      + '改一张已有的卡也用它，带 replacesId。到点提醒他本人的事不用这个。',
    parameters: ProposeParameters,
    replay: 'safe',
    async execute(toolCallId, raw, signal) {
      const args = checkedArgs(ProposeParameters, raw, 'schedule_propose');
      if (args.replacesId !== undefined
        && !canManageSchedule(state, scope.lineId, schedules.require(args.replacesId))) {
        throw new Error('只能修改自己负责的定时工作；跨队友协作请用 mate_handoff。');
      }
      const projectId = args.projectId ?? scope.projectId ?? STANDING_PROJECT_IDS.personal;
      const project = state.projects.get(projectId);
      if (project === undefined) {
        throw new Error(`没有这个项目：${projectId}。先用 list_projects 查项目 id。`);
      }
      const schedule = schedules.draft({ title: args.title, goal: args.goal, cadence: args.cadence, projectId,
        report: args.report ?? 'failures', place: args.place ?? null, outward: args.outward ?? null,
        replacesId: args.replacesId ?? null, draftedBy: `line:${scope.lineId}:${toolCallId}` });
      const card = scheduleCard(schedule, project.name, schedule.replacesId !== null);
      const outward = schedule.outward !== null;
      const ask = host.desk.commit((changes) => host.desk.raise(changes, {
        kind: outward ? 'approve' : 'confirm',
        purpose: QUESTION_PURPOSE,
        question: `${card.when} · ${schedule.title}`,
        detail: consequence(schedule),
        options: [{ id: CONFIRM, label: confirmLabel(schedule), recommended: true },
          { id: REVISE, label: outward ? '改名单' : '改一下' }],
        actionId: `schedule-card:${schedule.id}`,
        context: { lineId: scope.lineId, toolCallId, scheduleId: schedule.id, [SCHEDULE_CARD_CONTEXT_KEY]: card },
        basis: outward ? 'hard_line' : 'inferred',
        channel: scope.kind === 'background' ? 'interrupt' : 'popup',
      }));
      schedules.attachAsk(schedule.id, ask.id);
      const answered = await awaitAnswer(host, scope.lineId, ask, signal);
      if (answered.answer?.optionId !== CONFIRM) {
        schedules.decline(schedule.id);
        return { content: [{ type: 'text', text: `${answerSentence(answered)}。这张卡没有生效；照他说的改好，`
          + '再用 schedule_propose 起草一张给他确认。' }], details: { askId: answered.id } };
      }
      const confirmed = schedules.confirm(schedule.id, answered);
      return { content: [{ type: 'text', text: `他确认了，「${confirmed.title}」已生效。`
        + JSON.stringify(brief(confirmed, schedules.timeZone())) }], details: { askId: answered.id } };
    },
  };
}

function listTool(parts: TaskToolParts, scope: LineScope): AgentTool<typeof ListParameters> {
  return {
    name: 'schedule_list',
    label: '看定时任务',
    description: '列出定时任务（到点替他做的事）：做什么、什么时候、下次、上次结果、在不在用。',
    parameters: ListParameters,
    replay: 'safe',
    async execute() {
      const zone = parts.schedules.timeZone();
      return json({ timeZone: zone,
        schedules: parts.state.schedules.listed().filter((row) => canManageSchedule(parts.state, scope.lineId, row))
          .slice(0, LIST_MAX).map((row) => brief(row, zone)) });
    },
  };
}

function changeTool(parts: TaskToolParts, scope: LineScope): AgentTool<typeof ChangeParameters> {
  return {
    name: 'schedule_change',
    label: '停开定时任务',
    description: '他说停、恢复或删一个定时任务时用（pause / resume / remove）。要改内容或时间用 schedule_propose 带 replacesId。',
    parameters: ChangeParameters,
    async execute(_id, raw) {
      const args = checkedArgs(ChangeParameters, raw, 'schedule_change');
      const current = parts.schedules.require(args.scheduleId);
      if (!canManageSchedule(parts.state, scope.lineId, current)) {
        throw new Error('只能停开自己负责的定时工作。');
      }
      if (args.action === 'resume' && current.outward !== null) {
        throw new Error('以他名义发出的定时卡要他自己在任务栏目「定时」里打开开关。');
      }
      const changed = args.action === 'remove' ? parts.schedules.remove(current.id)
        : parts.schedules.setEnabled(current.id, args.action === 'resume');
      return json({ schedule: brief(changed, parts.schedules.timeZone()) });
    },
  };
}

function sendTool(parts: TaskToolParts, scope: LineScope): AgentTool<typeof SendParameters> {
  return {
    name: 'schedule_send',
    label: '照卡放行',
    description: '定时线里，点发送被设备拦下（submit_needs_you）后调：核过收件人、内容、网站都在他确认过的定时卡范围里，'
      + '回一个放行编号；再带 submitAsk=<放行编号> 原样点一次发送。每位每次一条。不在范围里会被拒，照旧先问他。',
    parameters: SendParameters,
    async execute(toolCallId, raw) {
      const args = checkedArgs(SendParameters, raw, 'schedule_send');
      const permit = grantSend(parts.state, { ...args, lineId: scope.lineId, toolCallId },
        (lineId) => parts.schedules.forLine(lineId)?.id);
      return { content: [{ type: 'text', text: `照卡放行了：发给「${permit.recipient}」。现在带 submitAsk=${permit.id} `
        + '原样点一次发送（同一个标签、同一版页面、同一个元素）。' }], details: { permitId: permit.id } };
    },
  };
}

function suggestTool(parts: TaskToolParts, scope: LineScope): AgentTool<typeof SuggestParameters> {
  return {
    name: 'suggest',
    label: '提一条建议',
    description: '主动想到一件能帮他的事、但他没要你做时用：出一张建议卡（做什么、为什么现在做），他点了才开始，'
      + '也能加成待办或忽略。他明说要做的事直接做，不用这个。',
    parameters: SuggestParameters,
    async execute(_id, raw) {
      const args = checkedArgs(SuggestParameters, raw, 'suggest');
      const result = parts.suggestions.suggest({ ...args, source: 'plasticine',
        projectId: args.projectId ?? scope.projectId, sourceRef: `line:${scope.lineId}` });
      if (result.suggestion === null) {
        return json({ suggestion: null, note: `「${result.held}」这类建议他最近都忽略了，这次先不出卡。` });
      }
      const { suggestion, created } = result;
      return json({ suggestion: { id: suggestion.id, status: suggestion.status },
        note: created ? '建议卡放进任务栏目「建议」了，他点了才开始。' : '同一件提过了，没有再出一张。' });
    },
  };
}

/** 起草定时卡要出卡、等他答：由内核交来它的等卡那一套（lines/ 的 askTools）。 */
export function scheduleProposeTool(parts: TaskToolParts): (host: AskToolHost) => KernelTool {
  return (host) => ({
    name: 'schedule_propose',
    say: (args) => `起草定时卡：${text(args['title'])}`,
    hardLine: () => null,
    create: (scope) => proposeTool(parts, host, scope),
  });
}

export function taskTools(parts: TaskToolParts): KernelTool[] {
  return [
    { name: 'schedule_list', say: () => '看定时任务', hardLine: () => null,
      create: (scope) => listTool(parts, scope) },
    { name: 'schedule_change', say: (args) => (args['action'] === 'remove' ? '删一个定时任务'
      : args['action'] === 'resume' ? '恢复一个定时任务' : '停一个定时任务'), hardLine: () => null,
    create: (scope) => changeTool(parts, scope) },
    { name: 'schedule_send', say: (args) => `照卡发给${text(args['recipient'])}`, hardLine: () => null,
      lineKinds: ['background'], create: (scope) => sendTool(parts, scope) },
    { name: 'suggest', say: (args) => `提一条建议：${text(args['title'])}`, hardLine: () => null,
      create: (scope) => suggestTool(parts, scope) },
  ];
}
