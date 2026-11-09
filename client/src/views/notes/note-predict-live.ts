// 一条续写从发出到收下的样子（2026-11-09 他定）：边生成边长（第一段字到了就画灰字），边打边吃（照 Copilot / Cursor：
// 接着打的字和灰字开头一样，灰字留着、只去掉打出的那部分，不作废也不重新要；对不上才撤下，等下一次停笔）。
// 中文输入法组字时不比，组完按提交进正文的字比。这里只有纯函数，计时、请求和画灰字在 note-suggestions.tsx。

import type { Node as DocumentNode } from '@tiptap/pm/model';

export interface LivePrediction {
  /** 发请求时光标的位置。 */
  readonly anchor: number;
  /** 已经到的建议全文（服务端去过重）；生成完换成最终文字。 */
  readonly text: string;
  /** 用户照着打掉了开头几个字。 */
  readonly typed: number;
  /** 最终文字到了。 */
  readonly done: boolean;
  /** 灰字现在贴着的那一版正文：光标在 anchor + typed。 */
  readonly doc: DocumentNode;
}

export interface CursorLike {
  readonly empty: boolean;
  readonly from: number;
}

export function startPrediction(anchor: number, doc: DocumentNode): LivePrediction {
  return { anchor, text: '', typed: 0, done: false, doc };
}

/** 还没打出来、要画成灰字的部分。 */
export function remaining(live: LivePrediction): string {
  return live.text.slice(live.typed);
}

/** 灰字从哪里开始（光标应该在的位置）。 */
export function ghostPosition(live: LivePrediction): number {
  return live.anchor + live.typed;
}

export function withDelta(live: LivePrediction, delta: string): LivePrediction {
  return { ...live, text: live.text + delta };
}

/** 最终文字到了：以它为准；它的开头已经和打出的字对不上（服务端收拾了结尾、用户正好打到那里）就作废。 */
export function withFinal(live: LivePrediction, text: string): LivePrediction | null {
  return text.startsWith(live.text.slice(0, live.typed)) ? { ...live, text, done: true } : null;
}

/**
 * 正文或光标变了之后这条续写还作不作数：
 * - 都没变：原样返回；
 * - 灰字位置后面多出来的字正好是灰字的开头，别处一个字没动，光标在新字后面（打字、输入法提交、粘贴都一样）：
 *   吃掉这几个字；
 * - 其余（打了别的字、删字、光标挪走、换段、打得比已经到的灰字还多）：作废，返回 null。
 */
export function followTyping(live: LivePrediction, doc: DocumentNode, cursor: CursorLike): LivePrediction | null {
  const position = ghostPosition(live);
  if (doc === live.doc) {
    return cursor.empty && cursor.from === position ? live : null;
  }
  const added = doc.content.size - live.doc.content.size;
  if (added <= 0 || added > remaining(live).length || !cursor.empty || cursor.from !== position + added) {
    return null;
  }
  // textBetween 不跨块：多出来的要是同一段里的 added 个字，块边界或图片会让它变短。
  const inserted = doc.textBetween(position, position + added);
  if (inserted.length !== added || inserted !== remaining(live).slice(0, added)) {
    return null;
  }
  const untouched = doc.cut(0, position).eq(live.doc.cut(0, position))
    && doc.cut(position + added).eq(live.doc.cut(position));
  return untouched ? { ...live, typed: live.typed + added, doc } : null;
}
