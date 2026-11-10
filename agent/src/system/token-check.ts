// 令牌检查器：扫一份 diff 里新增的界面行（client/ 下的 .css 和 .tsx）。原属自迭代（M5），2026-11 清理时自迭代删了，
// 它留下来当界面的令牌守卫（tests/system/token-check.test.ts 把现有界面整份当新增来查）。令牌表外的颜色、阴影、
// 字号就不过；碰 tokens.css 就是改令牌的值，在别处定义新的 --变量 就是新令牌。
// 规则照 plasticine-visual / references/visual-foundation.md 的方向 I 令牌表（2026-10-27 定），这里只认表里写着的值：
// - 颜色只用 var(--令牌)，不现写 #hex、rgb()、hsl() 和颜色名（transparent、currentColor、inherit 这类不是颜色值，可以）；
// - 阴影只有 none、var(--lift)，以及描边环 inset 0 0 0 1px var(--令牌)（描边环不算阴影）；
// - 字号只用字阶：24 · 22 · 16 · 15 · 14 · 13（按钮）· 12 · 11，单位 px，或者 inherit。
// 第 102 条（2026-11-02）视觉放开：去掉单一强调色与颜色数量的限制，保留对比度、深浅色、字号与间距基础档。所以
// 类别 / 项目色（tokens.css 的 --hue-*）和按它就地设的 --card-hue、--tile-hue 能用，color-mix 只要掺的都是令牌就行；
// 细线和色条（inset、不模糊、≤ 3px，颜色是令牌或 currentColor）不算阴影。现写色值、浮起的影子、字阶外的字号照旧不过。

import type { DiffFile } from './diff.ts';

/** 一处令牌表外的值：哪个文件、第几行、哪一类。 */
export interface TokenViolation {
  kind: 'color' | 'shadow' | 'font_size' | 'token_value';
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
  // 11-08 桌面客户端标题栏（shell/titlebar.tsx 在 .titlebar 上就地设）：左边红绿灯让出的宽度（壳报的
  // trafficLightInset）、右边 Windows 窗口按钮让出的宽度（壳报的 controlsRight）。
  'titlebar-lights',
  'titlebar-controls',
  // 11-08 第 7 批：图书翻页时一页的宽、高和页间距（books/page-surface.ts 按 .bk-sheet 量好，就地设在 .bk-text 上）。
  'page-width',
  'page-height',
  'page-gap',
];

/** 官网独立令牌仅供 client/src/views/site/ 使用；不放开普通应用的字号和阴影。 */
export const SITE_TOKENS: readonly string[] = [
  'ch-bg', 'ch-s1', 'ch-s2', 'ch-s3', 'ch-line', 'ch-line2', 'ch-fg', 'ch-fg2', 'ch-fg3', 'ch-accent', 'ch-blue',
  'ch-ok', 'ch-ease', 'ch-link', 'ch-link-hover', 'ch-header', 'ch-button-ink', 'ch-action-hover',
  'ch-accent-wash-strong', 'ch-pill-bg', 'ch-mask', 'ch-glow', 'ch-panel-end', 'ch-peer-avatar', 'ch-mine-bg',
  'ch-peer-bg', 'ch-link-active', 'ch-link-mine', 'ch-link-peer', 'ch-flow', 'ch-stage-bg', 'ch-accent-wash',
  'ch-blue-wash', 'ch-ok-wash', 'ch-blue-line', 'ch-accent-line', 'ch-mark', 'ch-paper', 'ch-ink', 'ch-ink2',
  'ch-highlight', 'ch-accent-line-strong', 'ch-paper-meta', 'ch-error', 'ch-report-accent', 'ch-size-hero',
  'ch-size-lead', 'ch-size-section', 'ch-size-figure', 'ch-size-window', 'ch-size-hero-phone',
  'ch-size-section-phone', 'ch-size-card', 'ch-shadow-button', 'ch-shadow-panel', 'ch-shadow-node',
  'ch-shadow-node-peer', 'ch-shadow-node-active', 'ch-shadow-node-peer-active', 'ch-shadow-bubble',
  'ch-shadow-bubble-peer', 'ch-shadow-invite', 'ch-shadow-window', 'ch-shadow-book', 'ch-shadow-archive',
];

export const SITE_FONT_TOKENS: readonly string[] = [
  'ch-size-hero', 'ch-size-lead', 'ch-size-section', 'ch-size-figure', 'ch-size-window', 'ch-size-hero-phone',
  'ch-size-section-phone', 'ch-size-card',
];

export const SITE_SHADOW_TOKENS: readonly string[] = [
  'ch-shadow-button', 'ch-shadow-panel', 'ch-shadow-node', 'ch-shadow-node-peer', 'ch-shadow-node-active',
  'ch-shadow-node-peer-active', 'ch-shadow-bubble', 'ch-shadow-bubble-peer', 'ch-shadow-invite',
  'ch-shadow-window', 'ch-shadow-book', 'ch-shadow-archive',
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

function knownVariable(name: string, site = false): boolean {
  return DESIGN_TOKENS.includes(name) || ELEMENT_HUE_VARIABLES.includes(name) || name === HUE_TEMPLATE
    || (site && SITE_TOKENS.includes(name));
}

const LENGTH = String.raw`(-?[0-9.]+(?:px)?)`;
const HAIRLINE = new RegExp(String.raw`^inset ${LENGTH} ${LENGTH} 0(?: ([0-9.]+(?:px)?))? `
  + String.raw`(var\(--([a-z0-9-]+)\)|currentColor)$`);

/** 一段 inset、不模糊的细线 / 色条 / 描边环：偏移和扩展都 ≤ 3px，颜色是令牌或 currentColor。 */
function hairlineAllowed(part: string, site: boolean): boolean {
  const match = HAIRLINE.exec(part.trim());
  if (match === null) {
    return false;
  }
  const sizes = [match[1], match[2], match[3] ?? '0'].map((size) => Math.abs(Number.parseFloat(size ?? '0')));
  return sizes.every((size) => size <= 3) && (match[4] === 'currentColor' || knownVariable(match[5] ?? '', site));
}

function shadowAllowed(value: string, site: boolean): boolean {
  const trimmed = value.trim().replace(/['"`,]+$/g, '').replace(/^['"`]/, '').trim();
  if (trimmed === 'none' || trimmed === 'var(--lift)'
    || (site && SITE_SHADOW_TOKENS.some((name) => trimmed === `var(--${name})`))) {
    return true;
  }
  return trimmed.split(/,(?![^(]*\))/).every((part) => hairlineAllowed(part, site));
}

function colorMixAllowed(code: string): boolean {
  const mix = COLOR_MIX.exec(code);
  if (mix === null) {
    return true;
  }
  return (mix[1] ?? '').split(/,(?![^(]*\))/).every((part) => COLOR_MIX_PART.test(part.trim()));
}

function fontSizeAllowed(value: string, site: boolean): boolean {
  const trimmed = value.trim().replace(/['"`]/g, '').replace(/\s*!important$/, '');
  if (trimmed === 'inherit' || trimmed === 'var(--read-size)'
    || (site && SITE_FONT_TOKENS.some((name) => trimmed === `var(--${name})`))) {
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
  const site = path.startsWith('client/src/views/site/');
  // Comments explain rules and quote values (「--accent #CC7D5E」); only code counts.
  const trimmed = text.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) {
    return found;
  }
  const code = isCss ? text.replace(/\/\*.*?\*\//g, '') : text.replace(/\/\/.*$/, '');
  // 变量名里的 blue 等词不是颜色字面量；变量是否登记仍由下面逐一核对。
  const literalCode = code.replace(/var\(--[a-z0-9-]+\)/gi, '');
  if ((isCss ? HEX : QUOTED_HEX).test(code) || COLOR_FUNCTION.test(code) || COLOR_NAMES.test(literalCode)
    || !colorMixAllowed(code)) {
    found.push(violation('color', path, line, text));
  }
  for (const match of code.matchAll(VARIABLE_USE)) {
    if (!knownVariable(match[1] ?? '', site)) {
      found.push(violation('color', path, line, `令牌表外的变量 --${match[1] ?? ''}：${text}`));
    }
  }
  const definition = VARIABLE_DEFINITION.exec(code);
  if (definition !== null && !READER_SCALE_TOKENS.includes(definition[1] ?? '')) {
    found.push(violation('token_value', path, line, `新令牌 --${definition[1] ?? ''}：${text}`));
  }
  const shadow = SHADOW.exec(code);
  if ((shadow !== null && !shadowAllowed(shadow[1] ?? '', site)) || DROP_SHADOW.test(code)) {
    found.push(violation('shadow', path, line, text));
  }
  const size = FONT_SIZE_CSS.exec(code) ?? FONT_SIZE_JS.exec(code);
  if (size !== null && !fontSizeAllowed(size[1] ?? '', site)) {
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
