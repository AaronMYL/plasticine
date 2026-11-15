// web/：网页的 AI 活——整页翻译（提示、用词表、输出解析）和提取重点归档进资料库。网页标签的存取在 state/，接口在 app/。

export { PageTranslator } from './page-translator.ts';
export type { GlossaryTerm } from './page-translator.ts';
export {
  WebExtractError, assertWebArchiveDestination, extractWebPage, prepareWebArchive, publishWebArchive,
} from './web-extract.ts';
