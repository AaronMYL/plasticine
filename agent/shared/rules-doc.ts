// 「怎么替你做事」最前面的硬线（《置信度与做事方式改动方案》「一页看懂」，11-04 用户定）：不管有没有把握，这几类都先问。
// 写在文档里是让 Plasticine 知道有这些线；真正拦住靠代码里现有的拦截（花钱、对外发出、删除、权限、设备动作各自的确认），
// 不靠 Plasticine 自觉。界面（记忆页那份文档的最前面）和上下文都只经 hardLines() 取，不另写一份。
//
// 硬线的正本在 agent/shared/act-or-ask.ts（HARD_LINES），这里只转一手，不另写一份。

import { HARD_LINES } from './act-or-ask.ts';

export function hardLines(): readonly string[] {
  return HARD_LINES;
}

/** 记忆页上这一段的标题。 */
export const HARD_LINES_HEADING = '先问你';
/** 这一段的补充说明（ⓘ 里）。 */
export const HARD_LINES_NOTE = '不管有没有把握，这几类都先问你；代码里也拦着，不靠 Plasticine 自觉。';

/** 给模型看的样子：「你」换成「用户」。 */
export function hardLinesForModel(): string[] {
  return hardLines().map((line) => line.replaceAll('你', '用户'));
}
