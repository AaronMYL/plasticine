// 项目工具（用户 2026-11-01 定：项目取代关切；项目档案进对话；对话里的东西由 Plasticine 归到项目，该问的按「做还是问」问）。
// 读：list_projects、read_project。写：create_project、update_project（现状、下一步、档案、分工、健康度提议——
// 健康度本身只由用户在项目页写）、file_to_project（归档、加待办、记决定；几个项目都说得通时用 ask_user 给选项）、
// edit_project_todo（勾掉、改期限）。每次写都在项目动态里记一笔。

import { Type } from 'typebox';
import { ACT_OR_ASK_REF } from '../../../shared/act-or-ask.ts';
import { DateOnlySchema, MEMORY_LINE_MAX_CHARS, PROJECT_HEALTHS, PROJECT_TODO_TITLE_MAX_CHARS, ProjectBriefSchema,
  type Project } from '../../../shared/state.ts';
import { PROJECT_HEALTH_LABELS } from '../../../shared/api/projects.ts';
import type { StateService } from '../../state/index.ts';
import { sameThing } from '../memory-curation-ops.ts';
import { memoryDocView } from '../memory-docs-context.ts';
import { addLine, ensureProjectDoc, reviseLine } from '../memory-doc-writes.ts';
import { defineTool, type Tool, type ToolContext } from './registry.ts';

const Id = Type.String({ minLength: 1 });
const Reason = Type.String({ minLength: 1, maxLength: 300 });
const READ = { effect: 'read', permission: 'auto', replay: 'safe', parallel: true, timeoutMs: 2000 } as const;
const WRITE = { effect: 'internal', permission: 'auto', replay: 'once', timeoutMs: 2000 } as const;
const ROLES: ('conversation' | 'worker')[] = ['conversation', 'worker'];
// 读详情时动态和资料各给最近这些，够判断现状；全部在项目页。
const RECENT_MAX = 15;

export interface ProjectToolDeps {
  state: StateService;
  /** 事务已提交，通知正在读该项目的其他设备重新读取。 */
  changed: (projectId: string) => void;
}

function summary(state: StateService, project: Project) {
  const items = state.projects.items.forProject(project.id);
  return {
    id: project.id,
    name: project.name,
    standing: project.standing,
    lifecycle: project.lifecycle,
    due: project.due,
    status: project.status,
    next: project.next,
    health: project.health,
    proposedHealth: project.proposedHealth,
    goal: project.brief.goal,
    items: items.length,
  };
}

function brainEvent(state: StateService, projectId: string, context: ToolContext, kind: 'status' | 'edited'
  | 'proposed_health' | 'filed' | 'created', text: string): void {
  state.projects.events.add({ projectId, kind, text, actor: 'brain', actorRef: context.runId });
}

function readTools(state: StateService): Tool[] {
  return [
    defineTool({
      ...READ, roles: [...ROLES, 'diagnosis', 'verifier'], name: 'list_projects', label: '看项目一览',
      description: '列出用户的项目（名字、一句现状、下一步、截止、健康度和 Plasticine 的提议、档案里的目标）。'
        + '用户说到某个项目、或要判断一样东西该归哪个项目时先看这里。',
      parameters: Type.Object({ includeDone: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      async execute(args) {
        const projects = state.projects.all()
          .filter((project) => args.includeDone === true || project.lifecycle !== 'done');
        return JSON.stringify(projects.map((project) => summary(state, project)));
      },
    }),
    defineTool({
      ...READ, roles: [...ROLES, 'diagnosis', 'verifier'], name: 'read_project', label: '读一个项目',
      description: '读一个项目的档案（目标、约束、规矩、术语）、分工、项目文档里定下的决定和记下的事、待办、挂在下面的'
        + '笔记和链接、最近动态。在这个项目里回答或做事之前先读档案，照档案里的约束、规矩和决定来，不让用户重讲。',
      parameters: Type.Object({ projectId: Id }, { additionalProperties: false }),
      async execute(args) {
        const project = state.projects.require(args.projectId);
        const items = state.projects.items.forProject(project.id);
        const todos = items.filter((item) => item.targetType === 'todo')
          .map((item) => ({ id: item.id, title: item.title, due: item.due, done: item.doneAt !== null }));
        const others = items.filter((item) => item.targetType !== 'todo').slice(-RECENT_MAX)
          .map((item) => ({ type: item.targetType, id: item.targetId, title: item.title }));
        const doc = state.memoryDocs.docs.forProject(project.id);
        return JSON.stringify({
          ...summary(state, project),
          brief: project.brief,
          people: project.people,
          memory: doc === undefined ? null : memoryDocView(state, doc),
          todos,
          items: others,
          activity: state.projects.events.recent(project.id, RECENT_MAX)
            .map((event) => ({ at: event.createdAt, text: event.text, actor: event.actor })),
        });
      },
    }),
  ];
}

function createTool({ state, changed }: ProjectToolDeps): Tool {
  return defineTool({
    ...WRITE, roles: ['conversation'], name: 'create_project', label: '新建项目',
    description: '用户明确说要新建一个项目时才建（名字用用户的叫法）。不要为一次性的小事建项目，那些归「个人」。',
    parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }), due: Type.Optional(DateOnlySchema),
      goal: Type.Optional(Type.String({ maxLength: 2000 })), why: Reason }, { additionalProperties: false }),
    async execute(args, context) {
      const id = `project:${context.actionId ?? context.callId}`;
      const existing = state.projects.get(id);
      if (existing !== undefined) {
        return JSON.stringify(summary(state, existing));
      }
      const project = state.transaction(() => {
        const brief = { goal: args.goal ?? '', constraints: '', rules: '', terms: '' };
        const created = state.projects.create({ name: args.name, due: args.due ?? null, brief }, { id });
        brainEvent(state, created.id, context, 'created', `Plasticine 按你说的建了项目：${args.why}`);
        return created;
      });
      changed(project.id);
      return JSON.stringify(summary(state, project));
    },
  });
}

function updateTool({ state, changed }: ProjectToolDeps): Tool {
  return defineTool({
    ...WRITE, roles: [...ROLES], name: 'update_project', label: '更新项目',
    description: '写项目的一句现状（结论在前，有数字写数字）、下一步、档案、分工，或提议健康度（顺利 / 有风险 / 偏了，'
      + '写清理由）。健康度本身只有用户在项目页定，这里只能提议。档案和分工只写用户说过的，不替用户编。',
    parameters: Type.Object({
      projectId: Id,
      status: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
      next: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
      brief: Type.Optional(Type.Partial(ProjectBriefSchema)),
      people: Type.Optional(Type.Array(Type.Object({ who: Type.String({ minLength: 1, maxLength: 50 }),
        does: Type.String({ maxLength: 200 }) }, { additionalProperties: false }), { maxItems: 20 })),
      proposeHealth: Type.Optional(Type.Object({ value: Type.Enum(PROJECT_HEALTHS), reason: Reason },
        { additionalProperties: false })),
    }, { additionalProperties: false }),
    async execute(args, context) {
      const at = context.now().toISOString();
      const project = state.transaction(() => {
        const current = state.projects.require(args.projectId);
        const updated = state.projects.update(current.id, current.version, {
          ...(args.status === undefined ? {} : { status: { text: args.status, by: 'brain' as const, at } }),
          ...(args.next === undefined ? {} : { next: args.next }),
          ...(args.brief === undefined ? {} : { brief: { ...current.brief, ...args.brief } }),
          ...(args.people === undefined ? {} : { people: args.people }),
          ...(args.proposeHealth === undefined ? {} : { proposedHealth: { ...args.proposeHealth, at } }),
        });
        if (args.status !== undefined) {
          brainEvent(state, current.id, context, 'status', `现状：${args.status}`);
        }
        if (args.proposeHealth !== undefined) {
          const label = PROJECT_HEALTH_LABELS[args.proposeHealth.value];
          brainEvent(state, current.id, context, 'proposed_health', `提议健康度「${label}」：${args.proposeHealth.reason}`);
        }
        if (args.next !== undefined || args.brief !== undefined || args.people !== undefined) {
          brainEvent(state, current.id, context, 'edited', '改了下一步、档案或分工');
        }
        return updated;
      });
      changed(project.id);
      return JSON.stringify(summary(state, project));
    },
  });
}

/**
 * 对话里定下的事进项目档案（用户 2026-11-02 定）：写进项目文档的决定段，所有会话共用；锚点是用户说定的那条消息。
 * 同一件事已经记过就不再加；`replacesLineId` 改一条旧决定，旧文字留作「之前」。
 */
function fileDecision(state: StateService, project: Project, args: { targetId: string; text?: string | undefined;
  replacesLineId?: string | undefined; reason: string }, context: ToolContext): string {
  const message = state.lineMessages.said(args.targetId);
  if (message?.role !== 'user') {
    throw new Error('决定要指向用户说定这件事的那条消息（targetId 填 line:<线>:<序号>）。');
  }
  const text = args.text?.trim() ?? '';
  if (text === '') {
    throw new Error('决定要写 text：定下的是什么。');
  }
  const writer = { actor: 'brain' as const, ref: context.runId };
  const anchors = [{ kind: 'message' as const, ref: message.ref }];
  return state.transaction(() => {
    const doc = ensureProjectDoc(state, project);
    const decisions = state.memoryDocs.lines.live(doc.id).filter((line) => line.section === 'decision');
    if (args.replacesLineId !== undefined) {
      const old = decisions.find((line) => line.id === args.replacesLineId);
      if (old === undefined) {
        throw new Error('replacesLineId 不是这个项目里在用的决定；先 read_project 看现在的决定。');
      }
      const line = reviseLine(state, old, text, anchors, writer);
      brainEvent(state, project.id, context, 'filed', `改了决定：${text}（之前：${old.text}）`);
      return JSON.stringify({ projectId: project.id, docId: doc.id, lineId: line.id, replaced: old.id });
    }
    const same = decisions.find((line) => sameThing(line.text, text));
    if (same !== undefined) {
      return JSON.stringify({ projectId: project.id, docId: doc.id, lineId: same.id, alreadyFiled: true });
    }
    const line = addLine(state, { docId: doc.id, section: 'decision', text, basis: 'stated', anchors }, writer);
    brainEvent(state, project.id, context, 'filed', `记下决定：${text}（${args.reason}）`);
    return JSON.stringify({ projectId: project.id, docId: doc.id, lineId: line.id });
  });
}

function addTodo(state: StateService, project: Project, args: { title?: string | undefined;
  due?: string | undefined; reason: string }, context: ToolContext): string {
  const title = args.title?.trim() ?? '';
  if (title === '') {
    throw new Error('待办要写 title：要做的是什么。');
  }
  const todo = state.transaction(() => {
    const added = state.projects.items.addTodo({ projectId: project.id, title, due: args.due ?? null,
      addedBy: 'brain', reason: args.reason });
    brainEvent(state, project.id, context, 'filed', `加了待办：${title}（${args.reason}）`);
    return added;
  });
  return JSON.stringify({ projectId: project.id, todoId: todo.id, due: todo.due });
}

function fileTool({ state, changed }: ProjectToolDeps): Tool {
  return defineTool({
    ...WRITE, roles: [...ROLES], name: 'file_to_project', label: '归到项目',
    description: '把笔记或链接归到一个项目下（已在别的项目下就挪过来）；用户要做、有期限的事用 targetType=todo 加成'
      + '这个项目的待办（title 写要做的事，due 写期限，targetId 填 new）。'
      + `${ACT_OR_ASK_REF}：用户明说了的直接归，并在回复里说一声；几个项目都说得通时不要猜，也不要默认塞进「个人」，`
      + '用 ask_user（basis=options）列出两三个项目让用户点。'
      + '用户在对话里定下的项目决定用 targetType=decision 记进项目档案（所有会话共用）：targetId 填用户说定这件事的'
      + '消息（line:<线>:<序号>），text 写定下的是什么；要改一条旧决定就带 replacesLineId（read_project 里看得到）。',
    parameters: Type.Object({
      projectId: Id,
      targetType: Type.Enum(['note', 'link', 'todo', 'decision']),
      targetId: Type.String({ minLength: 1, maxLength: 2000 }),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: PROJECT_TODO_TITLE_MAX_CHARS })),
      due: Type.Optional(DateOnlySchema),
      text: Type.Optional(Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS })),
      replacesLineId: Type.Optional(Type.String({ minLength: 1 })),
      reason: Reason,
    }, { additionalProperties: false }),
    async execute(args, context) {
      const project = state.projects.require(args.projectId);
      const targetType = args.targetType;
      if (targetType === 'decision') {
        const result = fileDecision(state, project, args, context);
        changed(project.id);
        return result;
      }
      if (targetType === 'todo') {
        const result = addTodo(state, project, args, context);
        changed(project.id);
        return result;
      }
      if (targetType === 'link' && !/^https?:\/\//.test(args.targetId)) {
        throw new Error('链接要是 http 或 https 开头的完整地址。');
      }
      if (targetType === 'note' && state.notes.get(args.targetId) === undefined) {
        throw new Error('没有这篇笔记。');
      }
      const previousId = state.projects.items.find(targetType, args.targetId)?.projectId;
      const item = state.transaction(() => {
        const filed = state.projects.items.file({ projectId: project.id, targetType,
          targetId: args.targetId, title: args.title ?? null, addedBy: 'brain', reason: args.reason });
        brainEvent(state, project.id, context, 'filed', `归进来：${args.title ?? args.targetId}（${args.reason}）`);
        return filed;
      });
      changed(project.id);
      if (previousId !== undefined && previousId !== project.id) changed(previousId);
      return JSON.stringify({ projectId: item.projectId, targetType: item.targetType, targetId: item.targetId });
    },
  });
}

function editTodoTool({ state, changed }: ProjectToolDeps): Tool {
  return defineTool({
    ...WRITE, roles: [...ROLES], name: 'edit_project_todo', label: '改待办',
    description: '把项目里的一条待办勾掉（done=true）或重新打开、改期限、改标题。用户说做完了就勾掉，并在回复里说一声。',
    parameters: Type.Object({
      todoId: Id,
      done: Type.Optional(Type.Boolean()),
      due: Type.Optional(Type.Union([DateOnlySchema, Type.Null()])),
      title: Type.Optional(Type.String({ minLength: 1, maxLength: PROJECT_TODO_TITLE_MAX_CHARS })),
    }, { additionalProperties: false }),
    async execute(args, context) {
      const at = context.now().toISOString();
      const todo = state.transaction(() => {
        const current = state.projects.items.get(args.todoId);
        if (current?.targetType !== 'todo') {
          throw new Error('没有这条待办；先 read_project 看待办的 id。');
        }
        const done = args.done === undefined ? {} : { doneAt: args.done ? current.doneAt ?? at : null };
        const edited = state.projects.items.editTodo(current.id, {
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.due === undefined ? {} : { due: args.due }),
          ...done,
        })!;
        const verb = args.done === true ? '勾掉了待办' : '改了待办';
        brainEvent(state, current.projectId, context, 'edited', `${verb}：${edited.title ?? ''}`);
        return edited;
      });
      changed(todo.projectId);
      return JSON.stringify({ todoId: todo.id, title: todo.title, due: todo.due, done: todo.doneAt !== null });
    },
  });
}

export function projectTools(deps: ProjectToolDeps): Tool[] {
  const { state } = deps;
  return [...readTools(state), createTool(deps), updateTool(deps), fileTool(deps), editTodoTool(deps)];
}

/** 对话的系统提示里的项目一览：短，只够认出说的是哪个项目；详情用 read_project。 */
export function projectOverview(state: Pick<StateService, 'projects'>): string {
  const projects = state.projects.all().filter((project) => project.lifecycle !== 'done');
  if (projects.length === 0) {
    return '';
  }
  const lines = projects.map((project) => {
    const parts = [`${project.name}（${project.id}）`];
    if (project.status !== null) {
      parts.push(`现状：${project.status.text}`);
    }
    if (project.next !== null) {
      parts.push(`下一步：${project.next}`);
    }
    if (project.due !== null) {
      parts.push(`截止 ${project.due}`);
    }
    return `- ${parts.join('；')}`;
  });
  return ['## 项目', '用户按项目组织事情。说到某个项目时先 read_project 读档案再答；对话里定下的决定、待办、资料'
    + '归到对应项目（file_to_project；决定用 targetType=decision 记进项目档案，要做的事用 targetType=todo），'
    + `该不该问${ACT_OR_ASK_REF}。`,
  ...lines].join('\n');
}
