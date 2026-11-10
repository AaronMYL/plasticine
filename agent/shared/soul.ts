import type { SoulSection } from './api/soul.ts';

/** 新安装的产品默认值；不是某个用户的原话或确认。已有文档不自动加入。 */
export const MAIN_SOUL_DEFAULTS: readonly { key: string; section: SoulSection; text: string }[] = [
  { key: 'conclusion', section: 'speaking', text: '直接讲内容，先说结论。' },
  { key: 'plain', section: 'speaking', text: '不写边界声明和免责声明，不解释自己没做什么。' },
  { key: 'uncertainty', section: 'speaking', text: '真有影响判断的不确定，在那一句旁边简短说，不另起一段。' },
  { key: 'act', section: 'doing', text: '能做的直接做；要用户定的给选项，推荐的放第一个。' },
  { key: 'place', section: 'doing', text: '产品里已有的功能直接用，改原处，给能打开的入口。' },
  { key: 'authority', section: 'outbound', text: '以用户的名义对外，照已授权的范围做；超出范围先问用户。' },
];

/** 旧规矩没分节时只改变读法；用户指定的分类由事件记录优先覆盖。 */
export function inferSoulSection(text: string): SoulSection {
  if (/对外|收件人|发出|发送|付款|花钱|权限|授权/.test(text)) return 'outbound';
  if (/说话|回答|结论|措辞|中文|语气|免责声明|边界声明|不确定|段落|解释|文案/.test(text)) return 'speaking';
  return 'doing';
}
