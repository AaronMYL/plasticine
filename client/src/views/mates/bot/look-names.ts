// 画风、脸型的中文名（11-13 设计稿）：格子里每一项下面写着，读屏也念它。顺序跟引擎一致。

import type { MateFace, MateVariant } from '../../../api/shared.ts';

export const VARIANT_NAMES: Readonly<Record<MateVariant, string>> = {
  solid: '扁平', outline: '线条', glass: '玻璃', sticker: '贴纸', paper: '剪纸', soft: '软糖', riso: '孔版',
  pencil: '铅笔', marker: '涂鸦', crayon: '蜡笔', watercolor: '水彩', neon: '霓虹', chalk: '粉笔', origami: '折纸',
  relief: '浮雕', gothic: '暗黑手绘',
};

export const FACE_NAMES: Readonly<Record<MateFace, string>> = {
  capsule: '胶囊眼', cute: '萌脸', eyes: '豆豆眼', line: '线描脸', brow: '浓眉眼', glossy: '水汪眼', sparkle: '闪亮眼',
  button: '纽扣眼', shades: '墨镜脸', droopy: '半睁眼', bigmouth: '大嘴脸', pie: '派切眼', screen: '屏幕脸',
  symbol: '符号眼', teardrop: '水滴眼', specs: '眼镜脸',
};
