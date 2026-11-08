// 「做还是问」那条线（《置信度与做事方式改动方案》开头「一页看懂」，第 5 批）：只在这里写一次，脑的提示、工具说明、
// 任务卡住时的说法都引用它。把握看资料里有没有，不给人或 AI 打分。硬线在代码里另有拦截（设备动作授权、提交前问你、
// 恢复备份……），这里只让 Plasticine 知道有这些线；真正拦住靠代码。

/** 出卡的依据：推出来的 · 有几种可能 · 资料里没有 · 硬线。「明说过的」直接做，不出卡，所以不在这里。 */
export const ASK_BASES = ['inferred', 'options', 'missing', 'hard_line'] as const;
export type AskBasis = (typeof ASK_BASES)[number];

export const ASK_BASIS_LABELS: Readonly<Record<AskBasis, string>> = {
  inferred: '推出来的',
  options: '有几种可能',
  missing: '资料里没有',
  hard_line: '硬线',
};

/** 不管有没有把握都问的事。「本人」就是用户，提示和界面里读着都通。 */
export const HARD_LINES = [
  '花钱',
  '以本人名义对外答应或发出',
  '删除和其他做了就撤不回的',
  '权限变化',
  '必须本人做的',
] as const;

/** 依据各是什么意思，给界面用（度量里分依据看时的 ⓘ）。 */
export const ASK_BASIS_MEANINGS: Readonly<Record<AskBasis, string>> = {
  inferred: '从你的话里推出来的：出一张确认卡，推荐项放第一个',
  options: '有几种都说得通：给选项',
  missing: '资料里没有：查过记忆、项目和原话仍缺，才问你',
  hard_line: `不管有没有把握都问你：${HARD_LINES.join('、')}`,
};

/** 整段，放进主会话和任务轮共用的身份提示（brain/identity.ts）。 */
export const ACT_OR_ASK_PROMPT = [
  '「做还是问」那条线（把握看资料里有没有，不给人或 AI 打分）：',
  '- 用户明说过的：直接做，做完告诉他；',
  '- 从用户的话里推出来的：出一张确认卡，推荐项放第一个；',
  '- 有几种都说得通的：给选项；',
  '- 资料里没有的：才问用户；',
  '- 要紧又没把握的：先去查（记忆、项目、原话、网页），查完再按上面几条。',
  `硬线，不管有没有把握都问：${HARD_LINES.join('；')}。`,
  '出卡时 basis 写这张卡属于哪一种（inferred 推出来的 / options 有几种可能 / missing 资料里没有 / hard_line 硬线）。',
].join('\n');

/** 别处说到「该不该问」时引用这一句，不再各写一套「拿不准就问」。 */
export const ACT_OR_ASK_REF = '按「做还是问」那条线';

/** 出卡工具（ask_user、request_input）的 basis 参数说明，给模型看。 */
export const BASIS_PARAMETER_DESCRIPTION = `为什么要问，${ACT_OR_ASK_REF}：`
  + 'inferred 从用户的话里推出来的（有且只有一个推荐项，就是推出来的那个）；options 有几种都说得通（至少两个选项）；'
  + `missing 资料里没有（查过记忆、项目、原话仍缺）；hard_line 硬线（${HARD_LINES.join('、')}）`;

/**
 * 依据和卡的样子要对得上：推出来的要有且只有一个推荐项（就是推出来的那个）；有几种可能要至少两个选项。
 * 资料里没有、硬线可以只写一句。对不上时返回一句给模型看的说明，对得上返回 null。
 */
export function basisShapeProblem(basis: AskBasis,
  options: readonly { id: string; recommended?: boolean | undefined }[]): string | null {
  if (basis === 'inferred' && options.filter((option) => option.recommended === true).length !== 1) {
    return '依据是「推出来的」：把推出来的那一项标成推荐（有且只有一个），放第一个。';
  }
  if (basis === 'options' && options.length < 2) {
    return '依据是「有几种可能」：至少给两个说得通的选项。';
  }
  return null;
}
