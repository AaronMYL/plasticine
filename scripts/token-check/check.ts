// 令牌检查器：扫一份 diff 里新增的界面行（client/ 下的 .css 和 .tsx），令牌表外的颜色、阴影、字号就不过；碰 tokens.css
// 就是改令牌的值，在别处定义新的 --变量 就是新令牌。原来在 agent/src/self/（自迭代的检查），2026-11-05 自迭代删掉后
// 挪到这里，由 check.test.ts 拿整份现有界面跑一遍（界面不许写死颜色）。
// 规则照 plasticine-visual / references/visual-foundation.md 的方向 I 令牌表（2026-10-27 定），这里只认表里写着的值：
// - 颜色只用 var(--令牌)，不现写 #hex、rgb()、hsl() 和颜色名（transparent、currentColor、inherit 这类不是颜色值，可以）；
// - 阴影只有 none、var(--lift)，以及描边环 inset 0 0 0 1px var(--令牌)（描边环不算阴影）；
// - 字号只用字阶：24 · 22 · 16 · 15 · 14 · 13（按钮）· 12 · 11，单位 px，或者 inherit。
// 第 102 条（2026-11-02）视觉放开：去掉单一强调色与颜色数量的限制，保留对比度、深浅色、字号与间距基础档。所以
// 类别 / 项目色（tokens.css 的 --hue-*）和按它就地设的 --card-hue、--tile-hue 能用，color-mix 只要掺的都是令牌就行；
// 细线和色条（inset、不模糊、≤ 3px，颜色是令牌或 currentColor）不算阴影。现写色值、浮起的影子、字阶外的字号照旧不过。

import type { DiffFile } from './diff.ts';

export const TOKEN_VIOLATION_KINDS = ['color', 'shadow', 'font_size', 'token_value'] as const;

export interface TokenViolation {
  kind: (typeof TOKEN_VIOLATION_KINDS)[number];
  file: string;
  line: number;
  text: string;
}

/** 方向 I 令牌表里的名字（tokens.css）。 */
export const DESIGN_TOKENS: readonly string[] = [
  'bg',
  'fg',
  'fg2',
  'fg3',
  'line',
  'line2',
  'tint',
  'tint2',
  'accent',
  'run',
  'ok',
  'err',
  'scrim',
  'lift',
  // 2026-11-05「照 0.2 老版暖米色」：你的消息气泡单独一个令牌（老版 #F0EAE3），不再借悬停底 --tint。
  'bubble',
  'sans',
  'mono',
  // 图书（第 100 条，用户 2026-11-01 定）：四种高亮色只做文字底；阅读正文的字号行距由读者用「Aa」调。
  'hl-ochre',
  'hl-sage',
  'hl-slate',
  'hl-rose',
  'read-size',
  'read-leading',
  // 邮件正文的白纸（2026-11-04 用户定「邮件按原样排版」）：邮件照白底设计，深色模式下也是白纸；只给邮件阅读区。
  'mail-paper',
  'qr-paper',
  'qr-ink',
  // 第 102 条：类别 / 项目色，深浅各一套（只染小方块、圆点、2px 色条和类别小字）。
  'hue-clay',
  'hue-ochre',
  'hue-teal',
  'hue-sky',
  'hue-rose',
  'hue-olive',
  'hue-slate',
  'hue-sage',
  'hue-err',
  'hue-ink',
  'hue-wash',
  // 设计稿 2026-11-03：区域分层（侧栏 · 标签栏 · 页面 · 悬浮对话框）、连接状态灯三色、动效时长与缓动。
  'layer-side',
  'layer-bar',
  'layer-page',
  'layer-float',
  'signal-on',
  'signal-wait',
  'signal-off',
  'motion-fast',
  'motion-base',
  'motion-slow',
  'ease-out',
  'ease-in-out',
  // 第 108 条：页面列最宽多少；对话框停在右边展开时页面列让出的宽度（壳在 .shell 上就地设，见 shell/layout.ts）。
  'page-max',
  'chat-reserve',
  // 11-08：Windows 右上角窗口按钮要让出的宽度（壳报的 controlsRight，壳在 .shell 上就地设）。
  'window-controls',
];

/** 元素上就地设成某个 --hue-* 的变量（shell/hue.tsx）：用它们等于用类别色令牌。 */
// 第 111 条：分组的组色（顶栏小签、组色线）、项目 chip 的圆点、书签小方块、新标签页分节的圆点、换色的色块，
// 都由 hueVar 就地设成某个 --hue-*。
export const ELEMENT_HUE_VARIABLES: readonly string[] = ['card-hue', 'tile-hue', 'group-hue', 'chip-hue', 'site-hue',
  'dot-hue', 'swatch'];

/** `var(--hue-${hue})`：按名字拼出来的类别色（shell/hue.tsx hueVar）。 */
const HUE_TEMPLATE = 'hue-';

/** 读者在阅读页上自己调的两个令牌：可以在元素上就地改值，字号也可以写成 var(--read-size)。 */
export const READER_SCALE_TOKENS: readonly string[] = ['read-size', 'read-leading'];

/** 字阶（visual-foundation.md「字号 / 行高 / 字重」，按钮 13/500 在「颜色、材质与形状」）。 */
export const FONT_SIZES_PX: readonly number[] = [11, 12, 13, 14, 15, 16, 22, 24];

export const TOKENS_FILE = 'client/src/tokens.css';

const STYLED_FILE = /^client\/src\/.*\.(?:css|tsx)$/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const QUOTED_HEX = /['"`]#[0-9a-fA-F]{3,8}['"`]/;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
// color-mix 里只许令牌（var(--…)）、transparent、currentColor 和百分比：掺现写色值仍算令牌表外的颜色。
const COLOR_MIX = /\bcolor-mix\(([^;]*)\)/i;
const TOKEN_USE = String.raw`var\(--[a-z0-9-]+\)`;
const COLOR_MIX_PART = new RegExp(String.raw`^(?:in [a-z-]+|${TOKEN_USE}(?:\s+(?:${TOKEN_USE}|\d+%))?`
  + String.raw`|(?:transparent|currentColor)(?:\s+\d+%)?)$`, 'i');
const VARIABLE_USE = /var\(--([a-z0-9-]+)/gi;
const VARIABLE_DEFINITION = /(?:^|[\s{;'"])--([a-z0-9-]+)\s*:/i;
const SHADOW = /(?:box-shadow|text-shadow|boxShadow|textShadow)\s*:\s*([^;]+)/;
const DROP_SHADOW = /drop-shadow\(/;
const FONT_SIZE_CSS = /font-size\s*:\s*([^;]+)/;
const FONT_SIZE_JS = /fontSize\s*:\s*([^,}]+)/;
const FONT_SHORTHAND = /(?:^|[\s;{])font\s*:\s*([^;]+)/;
// Common CSS colour names an edit might reach for; the full list has 148, these are the ones that turn up.
const NAMED_COLORS = [
  'white',
  'black',
  'red',
  'green',
  'blue',
  'gray',
  'grey',
  'orange',
  'purple',
  'yellow',
  'pink',
  'brown',
  'navy',
  'teal',
  'silver',
  'gold',
  'violet',
  'indigo',
  'cyan',
  'magenta',
];
const COLOR_PROPERTY = '(?:color|background(?:-color)?|border(?:-[a-z]+)?|outline(?:-color)?|fill|stroke|caret-color)';
const COLOR_NAMES = new RegExp(`${COLOR_PROPERTY}\\s*:\\s*[^;]*\\b(?:${NAMED_COLORS.join('|')})\\b`, 'i');

function violation(kind: TokenViolation['kind'], file: string, line: number, text: string): TokenViolation {
  return { kind, file, line, text: text.trim() };
}

function knownVariable(name: string): boolean {
  return DESIGN_TOKENS.includes(name) || ELEMENT_HUE_VARIABLES.includes(name) || name === HUE_TEMPLATE;
}

const LENGTH = String.raw`(-?[0-9.]+(?:px)?)`;
const HAIRLINE = new RegExp(String.raw`^inset ${LENGTH} ${LENGTH} 0(?: ([0-9.]+(?:px)?))? `
  + String.raw`(var\(--([a-z0-9-]+)\)|currentColor)$`);

/** 一段 inset、不模糊的细线 / 色条 / 描边环：偏移和扩展都 ≤ 3px，颜色是令牌或 currentColor。 */
function hairlineAllowed(part: string): boolean {
  const match = HAIRLINE.exec(part.trim());
  if (match === null) {
    return false;
  }
  const sizes = [match[1], match[2], match[3] ?? '0'].map((size) => Math.abs(Number.parseFloat(size ?? '0')));
  return sizes.every((size) => size <= 3) && (match[4] === 'currentColor' || knownVariable(match[5] ?? ''));
}

function shadowAllowed(value: string): boolean {
  const trimmed = value.trim().replace(/['"`,]+$/g, '').replace(/^['"`]/, '').trim();
  if (trimmed === 'none' || trimmed === 'var(--lift)') {
    return true;
  }
  return trimmed.split(/,(?![^(]*\))/).every(hairlineAllowed);
}

function colorMixAllowed(code: string): boolean {
  const mix = COLOR_MIX.exec(code);
  if (mix === null) {
    return true;
  }
  return (mix[1] ?? '').split(/,(?![^(]*\))/).every((part) => COLOR_MIX_PART.test(part.trim()));
}

function fontSizeAllowed(value: string): boolean {
  const trimmed = value.trim().replace(/['"`]/g, '').replace(/\s*!important$/, '');
  if (trimmed === 'inherit' || trimmed === 'var(--read-size)') {
    return true;
  }
  const px = /^(\d+)(?:px)?$/.exec(trimmed);
  return px !== null && FONT_SIZES_PX.includes(Number(px[1]));
}

/** `font: inherit` is fine; a shorthand that sets a size must use one of the sizes. */
function fontShorthandAllowed(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === 'inherit') {
    return true;
  }
  const size = /(\d+(?:\.\d+)?)(px|rem|em|pt|%)/.exec(trimmed);
  return size !== null && size[2] === 'px' && FONT_SIZES_PX.includes(Number(size[1]));
}

function lineViolations(path: string, line: number, text: string): TokenViolation[] {
  const found: TokenViolation[] = [];
  const isCss = path.endsWith('.css');
  // Comments explain rules and quote values (「--accent #CC7D5E」); only code counts.
  const trimmed = text.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) {
    return found;
  }
  const code = isCss ? text.replace(/\/\*.*?\*\//g, '') : text.replace(/\/\/.*$/, '');
  if ((isCss ? HEX : QUOTED_HEX).test(code) || COLOR_FUNCTION.test(code) || COLOR_NAMES.test(code)
    || !colorMixAllowed(code)) {
    found.push(violation('color', path, line, text));
  }
  for (const match of code.matchAll(VARIABLE_USE)) {
    if (!knownVariable(match[1] ?? '')) {
      found.push(violation('color', path, line, `令牌表外的变量 --${match[1] ?? ''}：${text}`));
    }
  }
  const definition = VARIABLE_DEFINITION.exec(code);
  if (definition !== null && !READER_SCALE_TOKENS.includes(definition[1] ?? '')) {
    found.push(violation('token_value', path, line, `新令牌 --${definition[1] ?? ''}：${text}`));
  }
  const shadow = SHADOW.exec(code);
  if ((shadow !== null && !shadowAllowed(shadow[1] ?? '')) || DROP_SHADOW.test(code)) {
    found.push(violation('shadow', path, line, text));
  }
  const size = FONT_SIZE_CSS.exec(code) ?? FONT_SIZE_JS.exec(code);
  if (size !== null && !fontSizeAllowed(size[1] ?? '')) {
    found.push(violation('font_size', path, line, text));
  }
  const shorthand = isCss ? FONT_SHORTHAND.exec(code) : null;
  if (shorthand !== null && !fontShorthandAllowed(shorthand[1] ?? '')) {
    found.push(violation('font_size', path, line, text));
  }
  return found;
}

/** Every place the diff steps outside the token table; empty means it passes. */
export function checkTokens(files: readonly DiffFile[]): TokenViolation[] {
  const found: TokenViolation[] = [];
  for (const file of files) {
    if (file.path === TOKENS_FILE) {
      const changed = [...file.added, ...file.removed].filter((entry) => entry.text.trim() !== '');
      for (const entry of changed) {
        found.push(violation('token_value', file.path, entry.line, `改令牌：${entry.text}`));
      }
      continue;
    }
    if (!STYLED_FILE.test(file.path)) {
      continue;
    }
    for (const entry of file.added) {
      found.push(...lineViolations(file.path, entry.line, entry.text));
    }
  }
  return found;
}
