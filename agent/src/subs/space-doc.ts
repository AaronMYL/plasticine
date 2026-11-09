// 旧版式空间（11-06 的结构化文档，第 8 批第 6 条以前写的）还没重写成网页时，信息流顶部、首页「回顾」、订阅往期那一句
// 和几个数字从文档里读。新写的空间是网页，读法在 space-page.ts 的 pageSummary。

import type { SpaceDoc } from '../../shared/state.ts';

/** 旧版式的那一句和几个重点。 */
export function summaryOf(title: string, doc: Pick<SpaceDoc, 'headline' | 'stats'>):
  { headline: string; stats: SpaceDoc['stats'] } {
  return { headline: doc.headline ?? title, stats: doc.stats };
}
