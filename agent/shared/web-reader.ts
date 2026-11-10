/** 阅读模式短标题的上限。 */
const HEADING_MAX_CHARS = 30;

/** 阅读模式的一块：一段正文，或一个小标题。 */
export interface ReaderBlock {
  kind: 'paragraph' | 'heading';
  text: string;
}

/**
 * 阅读模式的正文：可见正文按行切块，去掉空行和连着出现的重复行；正文里有和页面标题一样的一行时，从它后面开始
 * （前面多是站名、导航，标题另外排在最上面）；短、句末没标点、后面紧跟着正文（长或以句号收尾）的一行当小标题。
 * 只是把读到的字排整齐，不改写、不摘要。
 */
export function readerBlocks(text: string, title = ''): ReaderBlock[] {
  const all = text.split(/\n+/).map((line) => line.trim()).filter((line) => line !== '');
  const titleAt = title.trim() === '' ? -1 : all.indexOf(title.trim());
  const lines = titleAt < 0 ? all : all.slice(titleAt + 1);
  const unique = lines.filter((line, index) => lines[index - 1] !== line);
  return unique.map((line, index) => {
    const next = unique[index + 1];
    const heading = Array.from(line).length <= HEADING_MAX_CHARS && !/[。！？.!?；;，,：:]$/.test(line)
      && next !== undefined && (Array.from(next).length > HEADING_MAX_CHARS || /[。！？.!?]$/.test(next));
    return { kind: heading ? 'heading' : 'paragraph', text: line };
  });
}
