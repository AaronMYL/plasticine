// 续写收下前去重（2026-11-09 他定）：模型有时把光标前已经写的几个字再写一遍（「我今天想去」→「想去公园」），或把光标后
// 已经写好的开头又写一遍，Tab 收下就重了。送给界面之前去掉：开头和光标前末尾重叠的部分、结尾和光标后开头重叠的部分。
// 边生成边送时，开头还可能是重叠的就先压着，能判断了再放；结尾要等生成完才知道，最终文字（done）里去掉。
//
// 判断保守，宁漏勿错：
// - 至少两个字才算重叠；一个字只在是标点或空白时算（「试」+「试看」是「试试看」，不能去）。
// - 英文、数字的重叠要落在词边界上（「the cat」+「at home」不是重叠）。
// - 只看光标前后最近 OVERLAP_WINDOW 个字：重复的是最后半句、一句，再远的不是这种毛病。

/** 一句话的长度够了；开头最多压这么多字就一定能判断。 */
export const OVERLAP_WINDOW = 120;
const WORD = /[A-Za-z0-9]/;
const LONE = /^[\p{P}\s]$/u;
const OPEN_QUOTE = /^["“「]/;
const CLOSE_QUOTE = /["”」]$/;

function joins(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && WORD.test(left) && WORD.test(right);
}

/** previous / next：重叠那段在原文里前面一个字、在另一边后面一个字。 */
function boundaryOk(previous: string | undefined, overlap: string, next: string | undefined): boolean {
  if (overlap.length === 1) {
    return LONE.test(overlap);
  }
  return !joins(previous, overlap[0]) && !joins(overlap.at(-1), next);
}

/** text 开头有几个字和 before 的末尾重复。 */
export function leadingOverlap(before: string, text: string): number {
  const tail = before.slice(-OVERLAP_WINDOW);
  for (let length = Math.min(tail.length, text.length); length > 0; length -= 1) {
    const overlap = text.slice(0, length);
    if (tail.endsWith(overlap) && boundaryOk(before[before.length - length - 1], overlap, text[length])) {
      return length;
    }
  }
  return 0;
}

/** text 结尾有几个字和 after 的开头重复；光标后先换行的（段尾）按下一段的开头比。 */
export function trailingOverlap(text: string, after: string): number {
  const head = after.replace(/^\s+/, '').slice(0, OVERLAP_WINDOW);
  for (let length = Math.min(head.length, text.length); length > 0; length -= 1) {
    const overlap = text.slice(text.length - length);
    if (head.startsWith(overlap) && boundaryOk(text[text.length - length - 1], overlap, head[length])) {
      return length;
    }
  }
  return 0;
}

/**
 * 生成到一半时开头还定不下来：start 还可能是 before 末尾更长一段的开头（start 在 before 里出现、且后面还有字）。
 * 这时送出去，后面的字一到可能发现是重复，已经画出来的灰字就收不回来了。
 */
export function overlapUndecided(before: string, start: string): boolean {
  const tail = before.slice(-OVERLAP_WINDOW);
  return start === '' || tail.slice(0, -1).includes(start);
}

function quoteLength(raw: string): number {
  return OPEN_QUOTE.test(raw) ? 1 : 0;
}

/** 一次续写从模型的增量到送给界面的字：开头去引号、去重叠（定不下来先压着），结尾在 finish 时收拾。 */
export class PredictText {
  readonly #before: string;
  readonly #after: string;
  #raw = '';
  /** 原文开头要去掉几个字（引号 + 重叠）；还定不下来是 null。 */
  #cut: number | null = null;
  #sent = 0;

  constructor(before: string, after: string) {
    this.#before = before;
    this.#after = after;
  }

  /** 收到一段增量，返回现在可以送出去的新字（可能是空串）。 */
  push(delta: string): string {
    this.#raw += delta;
    if (this.#cut === null) {
      const quote = quoteLength(this.#raw);
      const start = this.#raw.slice(quote);
      if (overlapUndecided(this.#before, start)) {
        return '';
      }
      this.#cut = quote + leadingOverlap(this.#before, start);
    }
    const text = this.#raw.slice(this.#cut);
    const fresh = text.slice(this.#sent);
    this.#sent = text.length;
    return fresh;
  }

  /** 生成完：raw 是模型的全文（不流式的模型只走这里）。送过的是它的开头，结尾可能被收拾掉一点。 */
  finish(raw: string): string {
    const decided = this.#cut !== null && raw.startsWith(this.#raw) ? this.#cut : null;
    const cut = decided ?? quoteLength(raw) + leadingOverlap(this.#before, raw.slice(quoteLength(raw)));
    const text = raw.slice(cut).trimEnd().replace(CLOSE_QUOTE, '');
    return text.slice(0, text.length - trailingOverlap(text, this.#after)).trimEnd();
  }
}
