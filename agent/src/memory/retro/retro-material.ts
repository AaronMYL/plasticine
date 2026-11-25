import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { plainText, type LineMessageRow, type LineRow, type StateService } from '../../state/index.ts';
import { touchedKeys, experienceDocsFor } from '../docs/experience-recall.ts';

export type RetroMaterialState = Pick<StateService, 'lines' | 'lineMessages' | 'memoryDocs'>;

export const MAX_STEPS = 80;
export const MAX_MATERIAL_CHARS = 24_000;
const RESULT_CHARS = 160;
const FAILED_CHARS = 500;
const GOAL_CHARS = 1_500;
const ANSWER_CHARS = 1_500;
const DOC_CHARS = 6_000;
export const RECENT_LINES = 40;
const RECENT_TITLE_CHARS = 60;
const MIN_STORY_CHARS = 8_000;

export interface RetroSkill {
  name: string;
  description: string;
  version: string;
  editable: boolean;
}

export interface RetroMaterial {
  text: string;
  steps: number;
  loadedSkills: string[];
  lastSeq: number;
  recentLineIds: string[];
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

function textOf(message: unknown): string {
  const plain = plainText(message);
  const text: unknown = typeof message === 'object' && message !== null ? Reflect.get(message, 'text') : undefined;
  return plain !== '' ? plain : typeof text === 'string' ? text : '';
}

function brief(args: unknown): string {
  return clip(JSON.stringify(args ?? {}), 200);
}

interface Step {
  name: string;
  args: unknown;
  result: ToolResultMessage | undefined;
}

function stepsOf(rows: readonly LineMessageRow[]): Step[] {
  const results = new Map<string, ToolResultMessage>();
  for (const row of rows) {
    const message = row.message as AgentMessage;
    if (message.role === 'toolResult') {
      results.set(message.toolCallId, message);
    }
  }
  return rows.flatMap((row) => {
    const message = row.message as AgentMessage;
    if (message.role !== 'assistant') {
      return [];
    }
    return message.content.flatMap((part) => (part.type === 'toolCall'
      ? [{ name: part.name, args: part.arguments, result: results.get(part.id) }] : []));
  });
}

function stepLines(steps: readonly Step[]): string[] {
  const shown = steps.slice(-MAX_STEPS);
  return shown.map((step, index) => {
    const failed = step.result?.isError === true;
    const afterFailure = index > 0 && shown[index - 1]?.result?.isError === true;
    const text = step.result === undefined ? '（没有结果）' : plainText(step.result);
    const size = failed || afterFailure ? FAILED_CHARS : RESULT_CHARS;
    return `${index + 1}. ${step.name} ${brief(step.args)} → ${failed ? '出错' : '成'}：${clip(text, size)}`;
  });
}

function opening(rows: readonly LineMessageRow[]): string {
  const first = rows.find((row) => row.role === 'user' || row.role === 'handoff');
  return first === undefined ? '' : clip(textOf(first.message), GOAL_CHARS);
}

function lastAnswer(rows: readonly LineMessageRow[]): string {
  const last = [...rows].reverse().find((row) => row.role === 'assistant' && plainText(row.message).trim() !== '');
  return last === undefined ? '' : clip(plainText(last.message), ANSWER_CHARS);
}

function experienceSection(state: RetroMaterialState, steps: readonly Step[]): string {
  const keys = [...new Set(steps.flatMap((step) => touchedKeys({ name: step.name, args: step.args },
    step.result === undefined ? '' : plainText(step.result))))];
  const related = experienceDocsFor(state, keys);
  const relatedIds = new Set(related.map((doc) => doc.id));
  const parts: string[] = [];
  let used = 0;
  for (const doc of related) {
    const lines = state.memoryDocs.lines.live(doc.id).map((line) => `  - [行:${line.id}] ${line.text}`);
    const block = [`- 「${doc.title}」（网站：${state.memoryDocs.usage.get(doc.id)?.sites.join('、') || '没记'}）`, ...lines]
      .join('\n');
    used += block.length;
    if (used > DOC_CHARS) {
      break;
    }
    parts.push(block);
  }
  const others = state.memoryDocs.docs.live().filter((doc) => doc.kind === 'how' && !relatedIds.has(doc.id))
    .map((doc) => `「${doc.title}」`);
  return ['## 已有的做事经验', ...parts, ...(others.length === 0 ? [] : [`其余几篇：${others.join('、')}`])].join('\n');
}

function skillSection(skills: readonly RetroSkill[], loaded: readonly string[], bodies: (name: string) => string | null)
  : string {
  const list = skills.slice(0, 60).map((skill) => `- ${skill.name}${skill.editable ? '' : '（随程序带的，不能改）'}：`
    + clip(skill.description, 120));
  const read = loaded.flatMap((name) => {
    const body = bodies(name);
    return body === null ? [] : [`### 这次读过的技能 ${name} 的 SKILL.md（要改就在这份上改，整份写回）\n${body}`];
  });
  return ['## 已有的技能', ...(list.length === 0 ? ['（还没有）'] : list), ...read].join('\n');
}

function recentDone(state: RetroMaterialState, line: LineRow): LineRow[] {
  return state.lines.list({ kind: 'background', visibleOnly: true, includeArchived: true, statuses: ['idle'],
    limit: RECENT_LINES + 1 }).filter((other) => other.id !== line.id && other.unmetReason === null)
    .slice(0, RECENT_LINES);
}

function recentSection(lines: readonly LineRow[]): string {
  return ['## 以前做成的事（新建技能时，在这里找同一类的，把线号写进 sameKindLines）',
    ...(lines.length === 0 ? ['（还没有）'] : lines.map((other) => `- [线:${other.id}] ${clip(other.title,
      RECENT_TITLE_CHARS)}（${other.updatedAt.slice(0, 10)}）`))].join('\n');
}

export function retroMaterial(state: RetroMaterialState, line: LineRow, afterSeq: number,
  skills: readonly RetroSkill[], bodies: (name: string) => string | null): RetroMaterial {
  const rows = state.lineMessages.after(line.id, afterSeq);
  const steps = stepsOf(rows);
  const loadedSkills = [...new Set(steps.filter((step) => step.name === 'skill_read').flatMap((step) => {
    const name: unknown = typeof step.args === 'object' && step.args !== null ? Reflect.get(step.args, 'name')
      : undefined;
    return typeof name === 'string' ? [name] : [];
  }))];
  const recent = recentDone(state, line);
  const outcome = line.unmetReason !== null ? `没做成：${line.unmetReason}`
    : line.status === 'failed' ? `没做完：${line.failure ?? '原因没记'}` : '做成了';
  const story = [
    `## 这件事：「${line.title}」`,
    `交代的话：${opening(rows) || '（这一段没有）'}`,
    `结果：${outcome}`,
    `最后说的：${lastAnswer(rows) || '（没有）'}`,
    `## 经过（${steps.length} 步${steps.length > MAX_STEPS ? `，只列最后 ${MAX_STEPS} 步` : ''}）`,
    ...stepLines(steps),
  ].join('\n');
  const catalog = Array.from([experienceSection(state, steps), skillSection(skills, loadedSkills, bodies),
    recentSection(recent)].join('\n')).slice(0, MAX_MATERIAL_CHARS - MIN_STORY_CHARS).join('');
  const text = `${Array.from(story).slice(0, MAX_MATERIAL_CHARS - catalog.length - 1).join('')}\n${catalog}`;
  return { text, steps: steps.length, loadedSkills,
    lastSeq: rows.at(-1)?.seq ?? afterSeq, recentLineIds: recent.map((other) => other.id) };
}
