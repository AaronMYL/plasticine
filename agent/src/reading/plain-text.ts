// 章节的纯文字：给模型读、给导出用。正文 html 是解析层规范过的（块之间没有空白），textContent 拼起来没有段落；
// 这里在每个块结束处补一个换行，下标不再和高亮位置对应，所以只给人和模型读，不用来定位。

const BLOCK_END = /<\/(p|h2|h3|h4|li|blockquote|pre)>|<br>|<hr>/g;
const TAG = /<[^>]+>/g;
const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };

export function chapterPlainText(html: string): string {
  return html
    .replace(BLOCK_END, '\n')
    .replace(TAG, '')
    .replace(/&(amp|lt|gt|quot);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{2,}/g, '\n')
    .trim();
}
