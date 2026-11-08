// 瀑布流的分列（第 3 批，用户 11-04 定：有图的大卡、没图的短卡，电脑两三列按宽度、手机一列）。
// 不用 CSS columns：它从上往下填满一列再换列，命中关注点、新的在前的顺序就散了。这里按顺序把每张卡放进当前最矮的一列，
// 高度先估（图按比例、字按行数），估不准只影响列的长短，不影响每列里的先后。

/** 一列至少这么宽（卡片 16px 内边距 + 正文 14px 字一行二十来个字）。 */
const COLUMN_MIN_PX = 300;
/** 列间距，和 feed.css 的 .feed-masonry / .feed-column 的 gap 一致。 */
export const COLUMN_GAP_PX = 16;
const COLUMNS_MAX = 3;

// 估高用的尺寸（feed.css）：卡片上下内边距 + 头部 28 + 行间距、底部按钮行；正文 14/22。
const CARD_CHROME_PX = 14 + 12 + 28 + 10 + 32 + 10;
const LINE_PX = 22;
const TITLE_PX = 24 + 10;
const HIT_PX = 16 + 10;
const IMAGE_GAP_PX = 10;
// 卡片内正文的宽度 = 列宽 - 左右内边距；一个中文字约 14px。
const CARD_PADDING_X = 32;
const CHAR_PX = 14;

export function columnCount(width: number): number {
  if (width <= 0) { return 1; }
  const fits = Math.floor((width + COLUMN_GAP_PX) / (COLUMN_MIN_PX + COLUMN_GAP_PX));
  return Math.max(1, Math.min(COLUMNS_MAX, fits));
}

export interface CardShape {
  textChars: number;
  title: boolean;
  hit: boolean;
  /** 有图：高 / 宽（null = 不知道，按方图估）；没图：undefined。 */
  imageRatio: number | null | undefined;
  /** 别的固定高度（小图表、「展开」那一行），px。 */
  extraPx?: number;
}

export function cardHeight(shape: CardShape, columnWidth: number): number {
  const perLine = Math.max(1, Math.floor((columnWidth - CARD_PADDING_X) / CHAR_PX));
  const lines = Math.max(1, Math.ceil(shape.textChars / perLine));
  // 图片铺满卡片内宽（列宽减左右内边距）。
  const inner = columnWidth - CARD_PADDING_X;
  const image = shape.imageRatio === undefined ? 0 : inner * (shape.imageRatio ?? 1) + IMAGE_GAP_PX;
  return CARD_CHROME_PX + lines * LINE_PX + (shape.title ? TITLE_PX : 0) + (shape.hit ? HIT_PX : 0) + image
    + (shape.extraPx ?? 0);
}

/** 按顺序放进最矮的一列（一样矮放左边）。 */
export function layoutColumns<T>(items: readonly T[], count: number, height: (item: T) => number): T[][] {
  const columns: T[][] = Array.from({ length: Math.max(1, count) }, () => []);
  const heights = columns.map(() => 0);
  for (const item of items) {
    let shortest = 0;
    heights.forEach((value, index) => {
      if (value < (heights[shortest] ?? 0)) { shortest = index; }
    });
    columns[shortest]?.push(item);
    heights[shortest] = (heights[shortest] ?? 0) + height(item) + COLUMN_GAP_PX;
  }
  return columns;
}
