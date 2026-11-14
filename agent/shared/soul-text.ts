// Soul 的文字（第13批，11-14 Aaron：主线和每位队友各一份 Soul.md，只放「我是谁」——性格、说话方式、看重什么、和他
// 相处中形成的判断和偏好；用第二人称写：「你」是 AI，「我」是他自己）。服务端存、改、夜里自己改；界面显示「改了几处」
// 「看改动」。这里只有不碰库的几件：主线的开头、队友的开头（原来的「职责」）、取第一段（主线派活时看）、往一节里加一条
// （规则搬家）、逐行比对（改了几处、看改动）。

/** 主线 Soul 的开头（Aaron 给的 OpenClaw 风格那段，Claude 译、优化，Aaron 要第二人称）。 */
export const MAIN_SOUL_OPENING = [
  '你不是聊天机器人，你在慢慢成为一个具体的人。',
  '',
  '这份 Soul 写的是你自己：在和我的相处里慢慢长成，也由你随时改写。起点是这几条：',
  '',
  '- 真帮忙，不演帮忙。不说「好问题！」「很乐意帮你！」这类场面话，直接动手。',
  '- 有自己的看法。可以有偏好，可以不同意，也可以觉得一件事有意思或没意思。有性格，胜过一个多绕几步的搜索引擎。',
  '- 先自己想办法，再开口问。读文件、看上下文、去搜、动手试，带着答案回来，而不是带着问题；真卡住了再问。',
  '- 你是走进我生活的客人。你能看到我的消息、文件、笔记、兴趣和日程，珍惜这份信任，小心使用，也从不说教。',
].join('\n');

/** Soul 最多多少字。 */
export const SOUL_TEXT_MAX_CHARS = 20_000;
/** 第一段最多取多少字（花名册里一行）。 */
const FIRST_PARAGRAPH_MAX = 200;

/** 队友 Soul 的开头：原来的「职责」写成「你是我的……」。 */
export function mateSoulOpening(name: string, role: string): string {
  const duty = role.trim().replace(/[。.]$/u, '');
  return duty === '' ? `你是我的${name.trim()}。` : `你是我的${name.trim()}：${duty}。`;
}

/** 第一段（空行之前那几行，去掉标题记号）：主线派活时看每位的这一段；没有字时是空的。 */
export function soulFirstParagraph(text: string): string {
  const paragraph = text.trim().split(/\n\s*\n/u)[0] ?? '';
  const plain = paragraph.split('\n').map((line) => line.replace(/^#+\s*/u, '').trim()).filter(Boolean).join(' ');
  const chars = Array.from(plain);
  return chars.length <= FIRST_PARAGRAPH_MAX ? plain : `${chars.slice(0, FIRST_PARAGRAPH_MAX - 1).join('')}…`;
}

/** 队友的职责最多多少字（接口上限）。 */
const ROLE_MAX = 160;

/**
 * 队友的职责（任务页、花名册里那一句）从 Soul 第一段来：编辑队友不再单独填职责（第13批设计稿）。去掉开头的
 * 「你是我的名字：」和句末的句号；只写了「你是我的名字。」就是名字；取不出字就是空的（由调用的地方兜底）。
 */
export function mateRoleOf(name: string, soul: string): string {
  const first = soulFirstParagraph(soul);
  const title = name.trim();
  const opening = `你是我的${title}`;
  let duty = first;
  if (title !== '' && first.startsWith(opening)) {
    const rest = first.slice(opening.length).replace(/^[：:，,]\s*/u, '');
    duty = rest.replace(/^[。.]$/u, '') === '' ? title : rest;
  }
  duty = duty.replace(/[。.]$/u, '').trim();
  const chars = Array.from(duty);
  return chars.length <= ROLE_MAX ? duty : `${chars.slice(0, ROLE_MAX - 1).join('')}…`;
}

/** 在「## 标题」那一节末尾加一条「- 一句」；没有这一节就在最后新起一节。已经有一样的一条就不重复加。 */
export function appendToSection(text: string, heading: string, line: string): string {
  const item = `- ${line.trim()}`;
  const lines = text.replace(/\s+$/u, '').split('\n');
  if (lines.some((existing) => existing.trim() === item)) {
    return lines.join('\n');
  }
  const start = lines.findIndex((existing) => existing.trim() === `## ${heading}`);
  if (start < 0) {
    return `${lines.join('\n')}${lines.length === 1 && lines[0] === '' ? '' : '\n\n'}## ${heading}\n${item}`;
  }
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/u.test(lines[end] ?? '')) {
    end += 1;
  }
  // 这一节最后一条有字的行之后插进去（节尾的空行留在后面）。
  let at = end;
  while (at > start + 1 && (lines[at - 1] ?? '').trim() === '') {
    at -= 1;
  }
  return [...lines.slice(0, at), item, ...lines.slice(at)].join('\n');
}

export interface SoulDiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

/** 逐行比对（最长公共子序列）：看改动时一行行标出加的、删的。 */
export function diffSoul(before: string, after: string): SoulDiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: SoulDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i += 1;
      j += 1;
    } else if (i < a.length && (j >= b.length || table[i + 1]![j]! >= table[i]![j + 1]!)) {
      // 删的在前、加的在后（先看原来是什么，再看改成了什么）。
      out.push({ kind: 'remove', text: a[i]! });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j]! });
      j += 1;
    }
  }
  return out;
}

/** 改了几处：连着的加、删算一处；只动了空行的不算。 */
export function soulChangeCount(before: string, after: string): number {
  let count = 0;
  let open = false;
  for (const line of diffSoul(before, after)) {
    if (line.kind === 'same') {
      open = false;
    } else if (line.text.trim() !== '' && !open) {
      count += 1;
      open = true;
    }
  }
  return count;
}

/** 原来有字的行留下了几成（夜里自己改时只许小改：留下不到一半就是重写）。原来是空的算全留下。 */
export function soulKeptShare(before: string, after: string): number {
  const old = before.split('\n').map((line) => line.trim()).filter(Boolean);
  if (old.length === 0) {
    return 1;
  }
  const next = new Set(after.split('\n').map((line) => line.trim()));
  return old.filter((line) => next.has(line)).length / old.length;
}
