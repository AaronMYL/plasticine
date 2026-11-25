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
