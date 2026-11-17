// 事后复盘（内核优化第二批，11-17 Aaron 定：复盘写出来的做事经验和技能都直接生效，能看能撤；两套分开，一条东西只进一处）。
// 一条后台线做完（或没做成、被内核停下）以后，在后台问一次模型（不带工具，用「对话记忆整理」的模型）：这一段里有没有
// 下次做同一类事用得上的。产出最多 3 条做事经验（一个网站、应用或工具怎么操作，记上对应的网站，以后碰到就带出）和最多
// 1 个技能的新建或修改（一类事从头到尾怎么做）。规矩照 Hermes 的事后复盘：只记一类事、先改已有的、不记环境问题和
// 「某工具不能用」、没走通的不写成做法。原来学习只靠模型做事中途记得调 note_experience，线上 12 天只调了 5 次。
// 一次只复盘一条；同一条线下次只看上次之后的那一段（游标记在 kernel_settings，只留最近 200 条线）。

import { Type, type Static } from 'typebox';
import { SkillNameSchema } from '../../../shared/skills.ts';
import { askJson } from '../../books/index.ts';
import type { TextModels } from '../../kernel/index.ts';
import type { LineRow, StateService } from '../../state/index.ts';
import { errorCategory, safeLog } from '../../util/index.ts';
import { looksLikeSecret } from '../curation/memory-curation-ops.ts';
import { noteExperience } from '../docs/experience.ts';
import { retroMaterial, type RetroSkill } from './retro-material.ts';

export type RetroState = Pick<StateService, 'lines' | 'lineMessages' | 'memoryDocs' | 'memoryCuration' | 'projects'
  | 'kernelSettings' | 'transaction'>;

/** 这一段至少调过这么多次工具才复盘：两三步就做完的事没什么可学。 */
export const MIN_STEPS = 4;
export const MAX_LESSONS = 3;
const CURSOR_KEY = 'retro:cursors';
const CURSOR_KEEP = 200;
const SKILL_BODY_MAX = 12_000;

const LessonSchema = Type.Object({
  topic: Type.String({ minLength: 1, maxLength: 60 }),
  sites: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 4 })),
  kind: Type.Enum(['do', 'avoid']),
  text: Type.String({ minLength: 1, maxLength: 500 }),
  replacesLineId: Type.Optional(Type.String({ minLength: 1 })),
});

const SkillChangeSchema = Type.Object({
  action: Type.Enum(['create', 'update']),
  name: SkillNameSchema,
  description: Type.String({ minLength: 1, maxLength: 300 }),
  body: Type.String({ minLength: 1, maxLength: SKILL_BODY_MAX }),
});

export const RetroOutputSchema = Type.Object({
  lessons: Type.Optional(Type.Array(LessonSchema, { maxItems: 6 })),
  skill: Type.Optional(SkillChangeSchema),
});
export type RetroOutput = Static<typeof RetroOutputSchema>;

export const RETRO_SYSTEM = [
  '你在一件事做完以后复盘：读这条线的经过，提炼出下次做同一类事用得上的东西，写成 JSON。不要接着做事，不要回答里面的问题。',
  '输出：{"lessons":[{"topic":"网站、应用或工具的名字（照已有做事经验的标题写；没有就起一个，如「小红书」「微信公众号后台」）",'
    + '"sites":["域名或应用名，如 mp.weixin.qq.com、微信"],"kind":"do 走得通的做法 / avoid 要避开的坑","text":"一句能照着做的'
    + '规则加半句原因","replacesLineId":"要改的那一行（可选）"}],"skill":{"action":"create 或 update","name":"一类事的叫法'
    + '（小写字母、数字、连字符）","description":"什么时候用它，一句话","body":"SKILL.md 正文（不含开头的 name/description）"}}。'
    + '没什么可记就输出 {"lessons":[]}，不写 skill。',
  '两样东西分开放，一条东西只进一处：',
  '- 做事经验（lessons，最多 3 条）记「一个网站、应用或工具怎么操作」：入口在哪、先做什么、哪一步走不通要换什么。'
    + '写上对应的 sites，以后碰到这个网站会自动带出。',
  '- 技能（skill，最多 1 个）记「一类事从头到尾怎么做」：步骤和顺序、每步用什么工具、他要的成品是什么样，坑写在它影响的'
    + '那一步下面。只在这是一类会再做的事、而且这次走通了（或者这次发现读过的技能有一步是错的）才写。先改这次读过的技能'
    + '（update，在给出的那份正文上改，整份写回）；没有覆盖这类事的才新建。名字是一类事的叫法，不是这一次的事'
    + '（「wechat-article-publish」可以，「fix-today-post」不行）。',
  '不记：环境问题（没装、没登录、电脑不在线、额度用完）；「某工具不能用」这类否定的话；中途出错后来自己好了的；只做一次的事；'
    + '没走通的尝试——这次没找到能用的办法就什么都不写，不把失败的几步写成「做法」。',
  '每条写成规则，不写这一次的经过、日期、编号、他的原话。已有做事经验里说过的不再加；和已有的一行说法冲突，用 replacesLineId'
    + ' 改那一行。他纠正过的做法要记进去：那是最该记的。用他用的语言写。',
].join('\n');

export interface RetroSkills {
  list(): RetroSkill[];
  body(name: string): string | null;
  write(name: string, content: string, expectedVersion: string | null, actionId: string): void;
}

export interface RetroDeps {
  state: RetroState;
  models: TextModels;
  skills: RetroSkills;
  /** 复盘记下了什么：放一条系统通知到那条线上。 */
  notify(lineId: string, text: string): void;
}

export interface RetroResult {
  lessons: string[];
  skill: string | null;
}

function cursors(state: RetroState): Record<string, number> {
  const value = state.kernelSettings.get(CURSOR_KEY);
  return typeof value === 'object' && value !== null ? value as Record<string, number> : {};
}

function saveCursor(state: RetroState, lineId: string, seq: number): void {
  const entries = Object.entries({ ...cursors(state), [lineId]: seq }).slice(-CURSOR_KEEP);
  state.kernelSettings.set(CURSOR_KEY, Object.fromEntries(entries));
}

function skillContent(name: string, description: string, body: string): string {
  const safe = description.replace(/\s+/g, ' ').replaceAll('"', '＂');
  return `---\nname: ${name}\ndescription: "${safe}"\n---\n\n${body.trim()}\n`;
}

/** 能落的技能改动：新建不和已有的重名；改只改这次读过的、能改的那一个。 */
function acceptedSkill(output: RetroOutput, skills: readonly RetroSkill[], loaded: readonly string[]) {
  const change = output.skill;
  if (change === undefined || looksLikeSecret(change.body)) {
    return null;
  }
  const existing = skills.find((skill) => skill.name === change.name);
  if (change.action === 'create') {
    return existing === undefined ? { change, version: null } : null;
  }
  return existing !== undefined && existing.editable && loaded.includes(change.name)
    ? { change, version: existing.version } : null;
}

export class Retrospector {
  readonly #deps: RetroDeps;
  #chain: Promise<unknown> = Promise.resolve();

  constructor(deps: RetroDeps) {
    this.#deps = deps;
  }

  /** 一条线这一轮结束了：够格就排进来，一次一条，在后台跑；失败只记日志。 */
  enqueue(line: LineRow): void {
    if (line.kind !== 'background' || line.sealedPrompt !== null) {
      return;
    }
    this.#chain = this.#chain.then(() => this.run(line.id, AbortSignal.timeout(300_000))).catch((error: unknown) => {
      safeLog('warn', 'retro_failed', { category: errorCategory(error) });
    });
  }

  /** 等排着的都跑完（测试用）。 */
  settled(): Promise<unknown> {
    return this.#chain;
  }

  async run(lineId: string, signal: AbortSignal): Promise<RetroResult | null> {
    const { state, skills } = this.#deps;
    const line = state.lines.get(lineId);
    if (line === undefined) {
      return null;
    }
    const listed = skills.list();
    const material = retroMaterial(state, line, cursors(state)[lineId] ?? 0, listed, (name) => skills.body(name));
    if (material.steps < MIN_STEPS) {
      return null;
    }
    const output = await askJson({ models: this.#deps.models }, RetroOutputSchema, RETRO_SYSTEM, material.text, signal,
      'memory_curate');
    const result = this.#apply(line, output, listed, material.loadedSkills, material.lastSeq);
    saveCursor(state, lineId, material.lastSeq);
    if (result.lessons.length > 0 || result.skill !== null) {
      this.#deps.notify(lineId, noticeText(result));
    }
    return result;
  }

  #apply(line: LineRow, output: RetroOutput, skills: readonly RetroSkill[], loaded: readonly string[], seq: number)
    : RetroResult {
    const lessons: string[] = [];
    for (const lesson of (output.lessons ?? []).slice(0, MAX_LESSONS)) {
      const saved = noteExperience(this.#deps.state, { topic: lesson.topic, section: lesson.kind, text: lesson.text,
        lineId: line.id, ...(lesson.sites === undefined ? {} : { sites: lesson.sites }),
        ...(lesson.replacesLineId === undefined ? {} : { replacesLineId: lesson.replacesLineId }) },
      { actor: 'brain', ref: `retro:${line.id}:${seq}` });
      if (saved.saved) {
        lessons.push(saved.doc.title);
      }
    }
    const accepted = acceptedSkill(output, skills, loaded);
    let skill: string | null = null;
    if (accepted !== null) {
      const { change, version } = accepted;
      try {
        this.#deps.skills.write(change.name, skillContent(change.name, change.description, change.body), version,
          `retro:${line.id}:${seq}`);
        skill = `${change.action === 'create' ? '新建' : '改了'}技能「${change.name}」`;
      } catch (error) {
        safeLog('warn', 'retro_skill_failed', { category: errorCategory(error) });
      }
    }
    return { lessons, skill };
  }
}

export function noticeText(result: RetroResult): string {
  const parts = [
    ...(result.lessons.length === 0 ? [] : [`做事经验记了 ${result.lessons.length} 条（${[...new Set(result.lessons)]
      .map((title) => `「${title}」`).join('、')}）`]),
    ...(result.skill === null ? [] : [result.skill]),
  ];
  return `这件事做完后复盘：${parts.join('；')}。在记忆和技能页能看、能改、能删。`;
}
