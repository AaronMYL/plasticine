// 报告不是文字堆砌（11-12，Aaron：「希望有更加丰富和个性的页面，而不是文字堆砌」）。线上看到的：版式底子里现成的块
// （数字条、结论卡、图表、对照表、流程……）大多数报告一个都没用，写出来就是几屏段落。这里在落库前看一眼：长报告没有
// 页头、或者现成的块用了不到两种，就退回去让模型照内容重排一次；同一页第二次再交就照收（不让它卡住）。
// 只看结构，不看内容；短的整理稿、网页归档、来信不查。

/** 正文少于这么多字的不查：几段话的备忘用不着排版。 */
const LONG_TEXT_CHARS = 1_200;

/** 一种块算一类；同一类用几次都只算一次。 */
// 第 13 批新版式的块（大数、要点格、案例、步骤、核查的判定……）一样算。
const BLOCKS: readonly (readonly [string, RegExp])[] = [
  ['数字条 / 关键数字', /class="[^"]*\b(rp-stats|facts|rp-verdict|rp-pulse|rp-num)\b/],
  ['结论卡 / 卡片', /class="[^"]*\b(rcard|paper|rp-points|rp-cases|rp-grid2|rp-dec|rp-fact)\b/],
  ['图表', /class="[^"]*\b(ch|brow)\b|<svg[\s>]/],
  ['对照表 / 改正', /class="[^"]*\b(rt|rp-fix)\b/],
  ['流程 / 条目 / 步骤 / 时间线', /class="[^"]*\b(chain|lst|cov|rp-steps|rp-time|rp-open)\b/],
  ['Plasticine 的判断', /class="[^"]*\b(byai|rp-brief|rp-note|rp-call)\b/],
  ['来源索引', /class="[^"]*\b(srcs|rp-srcs)\b/],
];

function plainText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
}

/** 这一页太素就给一段怎么改的话；够了是 null。 */
export function reportTooPlain(html: string): string | null {
  if (Array.from(plainText(html)).length < LONG_TEXT_CHARS) {
    return null;
  }
  const used = BLOCKS.filter(([, pattern]) => pattern.test(html)).map(([name]) => name);
  const hero = /class="[^"]*\brp-hero\b/.test(html);
  if (hero && used.length >= 2) {
    return null;
  }
  return [
    '这一页还没存：它是一长篇段落，读的人要自己从字里找结论。照内容重排一次再交（同一页再交一次会直接存）：',
    hero ? '' : '· 开头用 rp-hero：一句结论当大标题，下面 2–4 个数字（rp-stats）说清规模或结果。',
    '· 每一节先想这一节的内容是什么形状，再选块：一个最要紧的数用 rp-pulse；几个并列的结论用要点格（rp-points）或',
    '  结论卡（cards2）；有数就画图（横条现成，趋势、分布用内联 svg）；案例用 rp-cases，几条方向用 rp-steps；',
    '  两三样东西比较用对照表（rt）；先后用时间线（rp-time）或流程（chain）；你自己的判断放进 byai 或 rp-note。',
    '· 段落只留把这些块连起来的那几句，每节不超过两三段；最后一节是来源索引（srcs）。',
    `· 现在用到的块：${used.length === 0 ? '一个都没有' : used.join('、')}。数和图只用材料里有的，不为了好看编。`,
  ].filter((line) => line !== '').join('\n');
}
