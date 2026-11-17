// 事后复盘读什么（内核优化第二批，11-17）：一条后台线做完以后，把它这一段（上次复盘之后的）导成给复盘模型看的材料：
// 要做的事、结果、每一步调了什么和成没成——失败的那步和它后面那一步给多一点（坑和绕过去的办法都在这里），别的只要
// 一句；再加上已有的做事经验目录和技能目录，好让它先改已有的、不重复记。做法照 Hermes 的事后复盘（agent/background_review.py）
// 和 OpenBot 的技能建议（只看失败的步和它后面那一步，最多 80 步）。

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import { plainText, type LineMessageRow, type LineRow, type StateService } from '../../state/index.ts';
import { touchedKeys, experienceDocsFor } from '../docs/experience-recall.ts';

export type RetroMaterialState = Pick<StateService, 'lineMessages' | 'memoryDocs'>;

/** 一次复盘最多看这么多步。 */
export const MAX_STEPS = 80;
/** 材料最多这么多字（便宜模型一次读得完）。 */
export const MAX_MATERIAL_CHARS = 24_000;
const RESULT_CHARS = 160;
const FAILED_CHARS = 500;
const GOAL_CHARS = 1_500;
const ANSWER_CHARS = 1_500;
const DOC_CHARS = 6_000;

export interface RetroSkill {
  name: string;
  description: string;
  version: string;
  /** 能改（Plasticine 写的、他装的）；随程序带的只能读。 */
  editable: boolean;
}

export interface RetroMaterial {
  text: string;
  /** 这一段调过几次工具。 */
  steps: number;
  /** 这一段里读过的技能（skill_read）：复盘先改这些。 */
  loadedSkills: string[];
  /** 这一段最后一条消息的序号：下一次复盘从这之后看。 */
  lastSeq: number;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/** 一条消息的文字：普通消息看 content，交接、贴回的结果看 text。 */
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

/** 已有的做事经验：这一段碰到过的网站对应的那几篇放前面，带上行；其余只列名字。 */
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

/** 一条线上次复盘之后这一段的材料；afterSeq 是上次复盘到的序号。 */
export function retroMaterial(state: RetroMaterialState, line: LineRow, afterSeq: number,
  skills: readonly RetroSkill[], bodies: (name: string) => string | null): RetroMaterial {
  const rows = state.lineMessages.after(line.id, afterSeq);
  const steps = stepsOf(rows);
  const loadedSkills = [...new Set(steps.filter((step) => step.name === 'skill_read').flatMap((step) => {
    const name: unknown = typeof step.args === 'object' && step.args !== null ? Reflect.get(step.args, 'name')
      : undefined;
    return typeof name === 'string' ? [name] : [];
  }))];
  const outcome = line.unmetReason !== null ? `没做成：${line.unmetReason}`
    : line.status === 'failed' ? `没做完：${line.failure ?? '原因没记'}` : '做成了';
  const text = [
    `## 这件事：「${line.title}」`,
    `交代的话：${opening(rows) || '（这一段没有）'}`,
    `结果：${outcome}`,
    `最后说的：${lastAnswer(rows) || '（没有）'}`,
    `## 经过（${steps.length} 步${steps.length > MAX_STEPS ? `，只列最后 ${MAX_STEPS} 步` : ''}）`,
    ...stepLines(steps),
    experienceSection(state, steps),
    skillSection(skills, loadedSkills, bodies),
  ].join('\n');
  return { text: Array.from(text).slice(0, MAX_MATERIAL_CHARS).join(''), steps: steps.length, loadedSkills,
    lastSeq: rows.at(-1)?.seq ?? afterSeq };
}
