export const ASK_BASES = ['inferred', 'options', 'missing', 'hard_line'] as const;
export type AskBasis = (typeof ASK_BASES)[number];

export const ASK_BASIS_LABELS: Readonly<Record<AskBasis, string>> = {
  inferred: '推出来的',
  options: '有几种可能',
  missing: '资料里没有',
  hard_line: '硬线',
};

export const HARD_LINES = [
  '花钱',
  '以本人名义对外答应或发出',
  '删除和其他做了就撤不回的',
  '权限变化',
  '必须本人做的',
] as const;

export const ASK_BASIS_MEANINGS: Readonly<Record<AskBasis, string>> = {
  inferred: '从你的话里推出来的：出一张确认卡，推荐项放第一个',
  options: '有几种都说得通：给选项',
  missing: '资料里没有：查过记忆、项目和原话仍缺，才问你',
  hard_line: `不管有没有把握都问你：${HARD_LINES.join('、')}`,
};

export const ACT_OR_ASK_PROMPT = [
  '「做还是问」那条线（把握看资料里有没有，不给人或 AI 打分）：',
  '- 用户明说过的：直接做，做完告诉他；',
  '- 从用户的话里推出来的：出一张确认卡，推荐项放第一个；',
  '- 有几种都说得通的：给选项；',
  '- 资料里没有的：才问用户；',
  '- 要紧又没把握的：先去查（记忆、项目、原话、网页），查完再按上面几条。',
  `硬线，不管有没有把握都问：${HARD_LINES.join('；')}。`,
  '以本人名义对外发出按承诺和授权放行（11-16 用户定）：授权里有的直接发；一件事第一次要发时，发送工具自己出一张'
    + '对外授权卡，用户确认一次整件事的范围（哪个平台、发给谁、发什么、这件事期间），之后范围内不再问。'
    + '不要让用户逐条确认，交代给队友时也不要写「每条都要确认」；网页里付款、删除、改设置照旧每次问。',
  '出卡时 basis 写这张卡属于哪一种（inferred 推出来的 / options 有几种可能 / missing 资料里没有 / hard_line 硬线）。',
].join('\n');

export const ACT_OR_ASK_REF = '按「做还是问」那条线';

export const BASIS_PARAMETER_DESCRIPTION = `为什么要问，${ACT_OR_ASK_REF}：`
  + 'inferred 从用户的话里推出来的（有且只有一个推荐项，就是推出来的那个）；options 有几种都说得通（至少两个选项）；'
  + `missing 资料里没有（查过记忆、项目、原话仍缺）；hard_line 硬线（${HARD_LINES.join('、')}）`;

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
