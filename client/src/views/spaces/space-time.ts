// 空间的几处时间（第 8 批第 6 条，设计稿 11-09）：资料库卡片下面「来信 · 今天 08:30」、来信信纸顶上「2026 年 11 月 9 日」。
// 一律按本机时区。

import type { SpaceGenre } from '../../api/shared.ts';

/** 体裁的名字（卡片下面那一行）；旧版式按报告算。 */
export function genreLabel(genre: SpaceGenre | null): string {
  return genre === 'letter' ? '来信' : '报告';
}
