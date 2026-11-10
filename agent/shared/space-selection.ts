import { attribute, parseHtml, textOf, type HtmlElement } from './space-html.ts';

export const SPACE_PARAGRAPH_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dt,dd,figcaption';
const TAGS = new Set(SPACE_PARAGRAPH_SELECTOR.split(','));
const SKIP = new Set(['script', 'style', 'template', 'noscript']);
export interface SpaceParagraph { sectionId: string | null; paragraph: number; text: string }

export function normalizeSpaceSelection(text: string): string { return text.replace(/\s+/g, ' ').trim(); }

/** 与浏览器在原始片段上编号的顺序相同，不把合成的信纸题目与目录当成原文。 */
export function spaceParagraphs(html: string): SpaceParagraph[] {
  const paragraphs: SpaceParagraph[] = [];
  const walk = (node: HtmlElement, sectionId: string | null): void => {
    if (SKIP.has(node.name)) { return; }
    const section = node.name === 'section' ? attribute(node, 'id') ?? sectionId : sectionId;
    if (TAGS.has(node.name)) {
      paragraphs.push({ sectionId: section, paragraph: paragraphs.length + 1, text: normalizeSpaceSelection(textOf(node)) });
      return;
    }
    for (const child of node.children) { if (child.kind === 'element') walk(child, section); }
  };
  walk(parseHtml(html), null);
  return paragraphs;
}
