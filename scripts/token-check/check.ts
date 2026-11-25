import type { DiffFile } from './diff.ts';

/** Typography size tokens (each paired with a `-line` line-height token). */
export const TEXT_TOKENS: readonly string[] = ['text-tag', 'text-caption', 'text-ui', 'text-body', 'text-section',
  'text-long', 'text-number', 'text-title'];

export const TOKEN_VIOLATION_KINDS = ['color', 'shadow', 'font_size', 'token_value', 'number'] as const;

export interface TokenViolation {
  kind: (typeof TOKEN_VIOLATION_KINDS)[number];
  file: string;
  line: number;
  text: string;
}

/** Registered design token names defined in `client/src/tokens.css`. */
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
  'bubble',
  'sans',
  'mono',
  'hl-ochre',
  'hl-sage',
  'hl-slate',
  'hl-rose',
  'read-size',
  'read-leading',
  'mail-paper',
  'qr-paper',
  'qr-ink',
  'image-veil',
  'image-veil-ink',
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
  'hue-plum',
  'hue-indigo',
  'hue-wash',
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
  'ease-spring',
  'motion-spin',
  'motion-tick',
  'motion-pulse',
  'radius-sm',
  'radius',
  'radius-lg',
  'radius-full',
  'space-px',
  'space-hair',
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
  'space-7',
  ...TEXT_TOKENS.flatMap((name) => [name, `${name}-line`]),
  'control-xs',
  'control-sm',
  'control',
  'control-lg',
  'touch',
  'icon-xs',
  'icon-sm',
  'icon',
  'icon-lg',
  'avatar-sm',
  'avatar',
  'avatar-lg',
  'z-under',
  'z-raised',
  'z-sticky',
  'z-menu',
  'z-sheet',
  'z-chrome',
  'z-dialog',
  'z-over-dialog',
  'z-window',
  'z-float',
  'z-modal',
  'z-selection',
  'z-tip',
  'page-read',
  'page-manage',
  'page-gutter',
  'dock-room',
  'titlebar-room',
  'titlebar-lights',
  'titlebar-controls',
  'page-width',
  'page-height',
  'page-gap',
];

/** Standalone landing-page tokens restricted to `client/src/views/site/`. */
export const SITE_TOKENS: readonly string[] = [
  'ch-bg', 'ch-s1', 'ch-s2', 'ch-s3', 'ch-line', 'ch-line2', 'ch-fg', 'ch-fg2', 'ch-fg3', 'ch-accent', 'ch-blue',
  'ch-ok', 'ch-ease', 'ch-link', 'ch-link-hover', 'ch-header', 'ch-button-ink', 'ch-action-hover',
  'ch-accent-wash-strong', 'ch-pill-bg', 'ch-mask', 'ch-glow', 'ch-panel-end', 'ch-peer-avatar', 'ch-mine-bg',
  'ch-peer-bg', 'ch-link-active', 'ch-link-mine', 'ch-link-peer', 'ch-flow', 'ch-stage-bg', 'ch-accent-wash',
  'ch-blue-wash', 'ch-ok-wash', 'ch-blue-line', 'ch-accent-line', 'ch-mark', 'ch-paper', 'ch-ink', 'ch-ink2',
  'ch-highlight', 'ch-accent-line-strong', 'ch-paper-meta', 'ch-error', 'ch-report-accent', 'ch-size-hero',
  'ch-size-lead', 'ch-size-display', 'ch-size-title', 'ch-size-section', 'ch-size-figure', 'ch-size-window',
  'ch-size-hero-phone',
  'ch-size-section-phone', 'ch-size-card', 'ch-shadow-button', 'ch-shadow-stage', 'ch-shadow-phone',
  'ch-shadow-spark', 'ch-shadow-panel', 'ch-shadow-node',
  'ch-shadow-node-peer', 'ch-shadow-node-active', 'ch-shadow-node-peer-active', 'ch-shadow-bubble',
  'ch-shadow-bubble-peer', 'ch-shadow-invite', 'ch-shadow-window', 'ch-shadow-book', 'ch-shadow-archive',
];

export const SITE_FONT_TOKENS: readonly string[] = [
  'ch-size-hero', 'ch-size-lead', 'ch-size-display', 'ch-size-title', 'ch-size-section', 'ch-size-figure',
  'ch-size-window', 'ch-size-hero-phone',
  'ch-size-section-phone', 'ch-size-card',
];

export const SITE_SHADOW_TOKENS: readonly string[] = [
  'ch-shadow-button', 'ch-shadow-stage', 'ch-shadow-phone', 'ch-shadow-spark', 'ch-shadow-panel', 'ch-shadow-node',
  'ch-shadow-node-peer', 'ch-shadow-node-active',
  'ch-shadow-node-peer-active', 'ch-shadow-bubble', 'ch-shadow-bubble-peer', 'ch-shadow-invite',
  'ch-shadow-window', 'ch-shadow-book', 'ch-shadow-archive',
];

/** Scoped custom properties assigned from `--hue-*` tokens (`shell/hue.tsx`). */
export const ELEMENT_HUE_VARIABLES: readonly string[] = ['card-hue', 'tile-hue', 'group-hue', 'chip-hue', 'site-hue',
  'dot-hue', 'swatch'];

const HUE_TEMPLATE = 'hue-';

/** User-adjustable reader scale tokens allowed to be overridden locally. */
export const READER_SCALE_TOKENS: readonly string[] = ['read-size', 'read-leading'];

export const FONT_SIZES_PX: readonly number[] = [11, 12, 13, 14, 15, 16, 22, 24];

export const TOKENS_FILE = 'client/src/tokens.css';

const STYLED_FILE = /^client\/src\/.*\.(?:css|tsx)$/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const QUOTED_HEX = /['"`]#[0-9a-fA-F]{3,8}['"`]/;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
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
const NAMED_COLORS = [
  'white', 'black', 'red', 'green', 'blue', 'gray', 'grey', 'orange', 'purple', 'yellow',
  'pink', 'brown', 'navy', 'teal', 'silver', 'gold', 'violet', 'indigo', 'cyan', 'magenta',
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

/** Allows unblurred inset hairlines or focus rings <= 3px using a registered token or `currentColor`. */
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
    || TEXT_TOKENS.some((name) => trimmed === `var(--${name})`)
    || (site && SITE_FONT_TOKENS.some((name) => trimmed === `var(--${name})`))) {
    return true;
  }
  const px = /^(\d+)(?:px)?$/.exec(trimmed);
  return px !== null && FONT_SIZES_PX.includes(Number(px[1]));
}

function fontShorthandAllowed(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === 'inherit' || TEXT_TOKENS.some((name) => trimmed.includes(`var(--${name})`))) {
    return true;
  }
  const size = /(\d+(?:\.\d+)?)(px|rem|em|pt|%)/.exec(trimmed);
  return size !== null && size[2] === 'px' && FONT_SIZES_PX.includes(Number(size[1]));
}

const RADIUS_DECL = new RegExp(String.raw`(?:^|[\s;{])border(?:-(?:top|bottom)-(?:left|right)`
  + String.raw`|-(?:start|end)-(?:start|end))?-radius\s*:\s*([^;]+)`);
const SPACE_DECL = new RegExp(String.raw`(?:^|[\s;{])(?:padding|margin|scroll-padding|scroll-margin)`
  + String.raw`(?:-[a-z-]+)?\s*:\s*([^;]+)|(?:^|[\s;{])(?:row-|column-)?gap\s*:\s*([^;]+)`);
const LINE_HEIGHT_DECL = /(?:^|[\s;{])line-height\s*:\s*([^;]+)/;
const Z_DECL = /(?:^|[\s;{])z-index\s*:\s*([^;]+)/;
const MOTION_DECL = /(?:^|[\s;{])(?:transition|animation)(?:-(?:duration|delay|timing-function))?\s*:\s*([^;]+)/;
const EXCEPTION = /allow-exception:/;

function withoutTokens(value: string): string {
  return value.replace(/var\(--[a-z0-9-]+\)/gi, '');
}

function hasLength(value: string): boolean {
  const rest = withoutTokens(value).replace(/(?<![\w.-])-?0*\.?0+(?:px|%|rem|em)(?![\w-])/g, '');
  return /(?<![\w.-])-?\d*\.?\d+(?:px|%|rem|em)(?![\w-])/.test(rest);
}

function lineHeightAllowed(value: string): boolean {
  const rest = withoutTokens(value).trim().replace(/\s*!important$/, '');
  return rest === '' || /^(?:0|1|normal|inherit)$/.test(rest);
}

function zIndexAllowed(value: string): boolean {
  const trimmed = value.trim();
  return /^(?:auto|0|inherit)$/.test(trimmed) || /^var\(--z-[a-z-]+\)$/.test(trimmed)
    || /^calc\(var\(--z-[a-z-]+\) [+-] 1\)$/.test(trimmed);
}

function motionAllowed(value: string): boolean {
  const rest = withoutTokens(value);
  if (/(?<![\w.-])\d*\.?\d+m?s\b/.test(rest.replace(/(?<![\w.-])0m?s\b/g, ''))) {
    return false;
  }
  return !/(?<![\w-])(?:ease|ease-in|ease-out|ease-in-out)(?![\w-])|cubic-bezier\(/.test(rest);
}

function numberViolations(path: string, line: number, code: string, text: string): TokenViolation[] {
  const found: TokenViolation[] = [];
  if (EXCEPTION.test(text)) {
    return found;
  }
  const radius = RADIUS_DECL.exec(code);
  const space = SPACE_DECL.exec(code);
  const lineHeight = LINE_HEIGHT_DECL.exec(code);
  const z = Z_DECL.exec(code);
  const motion = MOTION_DECL.exec(code);
  if ((radius !== null && hasLength(radius[1] ?? ''))
    || (space !== null && hasLength(space[1] ?? space[2] ?? ''))
    || (lineHeight !== null && !lineHeightAllowed(lineHeight[1] ?? ''))
    || (z !== null && !zIndexAllowed(z[1] ?? ''))
    || (motion !== null && !motionAllowed(motion[1] ?? ''))) {
    found.push(violation('number', path, line, text));
  }
  return found;
}

function lineViolations(path: string, line: number, text: string): TokenViolation[] {
  const found: TokenViolation[] = [];
  const isCss = path.endsWith('.css');
  const site = path.startsWith('client/src/views/site/');
  const trimmed = text.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) {
    return found;
  }
  const code = isCss ? text.replace(/\/\*.*?\*\//g, '') : text.replace(/\/\/.*$/, '');
  const literalCode = code.replace(/var\(--[a-z0-9-]+\)/gi, '');
  if ((isCss ? HEX : QUOTED_HEX).test(code) || COLOR_FUNCTION.test(code) || COLOR_NAMES.test(literalCode)
    || !colorMixAllowed(code)) {
    found.push(violation('color', path, line, text));
  }
  for (const match of code.matchAll(VARIABLE_USE)) {
    if (!knownVariable(match[1] ?? '', site)) {
      found.push(violation('color', path, line, `Unregistered variable --${match[1] ?? ''}: ${text}`));
    }
  }
  const definition = VARIABLE_DEFINITION.exec(code);
  if (definition !== null && !READER_SCALE_TOKENS.includes(definition[1] ?? '')) {
    found.push(violation('token_value', path, line, `New token --${definition[1] ?? ''}: ${text}`));
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
  if (isCss && !site) {
    found.push(...numberViolations(path, line, code, text));
  }
  return found;
}

/** Returns all design-token violations across `files`; empty array means compliant. */
export function checkTokens(files: readonly DiffFile[]): TokenViolation[] {
  const found: TokenViolation[] = [];
  for (const file of files) {
    if (file.path === TOKENS_FILE) {
      const changed = [...file.added, ...file.removed].filter((entry) => entry.text.trim() !== '');
      for (const entry of changed) {
        found.push(violation('token_value', file.path, entry.line, `Modified token: ${entry.text}`));
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
