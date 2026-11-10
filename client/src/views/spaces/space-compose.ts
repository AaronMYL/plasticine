// 一页空间的整份 srcdoc（第 8 批第 6 条）：CSP、令牌、版式底子（agent/shared/space-page/）、iframe 里的运行时，
// 再是 space-document.ts 套好版式的 body。
// CSP 只放行内联样式和脚本、data: / blob: 图（插图由外面读好、在里面变成 blob 地址）；字体按字节传进去（FontFace），
// 不从网上载；connect-src 'none'，表单、base 都不行。沙盒（只给 allow-scripts）由 space-frame.tsx 加。

import type { SpaceGenre } from '../../api/shared.ts';
import { BASE_CSS, tokenCss, type SpaceToken } from '../../../../agent/shared/space-page/base-css.ts';
import { LETTER_CSS } from '../../../../agent/shared/space-page/letter-css.ts';
import { REPORT_CSS } from '../../../../agent/shared/space-page/report-css.ts';
import { spaceRuntime, type SpaceFrameMode } from './space-runtime.ts';

export const SPACE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
  + "img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; "
  + "base-uri 'none'";

// 缩略图（1200 宽渲染再缩小）里字太小看不清：开头那几样放大一点，像设计稿 Library-Spaces 的样子。
const THUMB_CSS = `
body.pz-thumb{overflow:hidden}
body.pz-thumb .rp-toc{display:none}
body.pz-thumb .rp-body{grid-template-columns:minmax(0,1fr)}
body.pz-thumb .rp{max-width:none;padding:0 80px}
body.pz-thumb .rp-hero{padding-top:64px}
body.pz-thumb .rp-kick{font-size:22px;line-height:32px}
body.pz-thumb .rp-h1{font-size:56px;line-height:72px;max-width:1000px}
body.pz-thumb .rp-stats{border-top-width:3px}
body.pz-thumb .rp-stat .v b{font-size:48px;line-height:60px}
body.pz-thumb .rp-stat .l{font-size:22px;line-height:30px}
body.pz-thumb .lt{max-width:960px;padding-top:64px}
body.pz-thumb .lt-date{font-size:22px;line-height:32px}
body.pz-thumb .lt-title{font-size:84px;line-height:100px}
body.pz-thumb .lt-body{font-size:26px;line-height:44px}
body.pz-thumb .lt-body>p.lt-lead{display:none}
body.pz-thumb .lt-fig{margin:36px 0 0}
body.pz-thumb .lt-fig img{height:300px;border-radius:20px}
body.pz-thumb .lt-fig figcaption{display:none}
`;

export interface ComposeInput {
  body: string;
  genre: SpaceGenre;
  mode: SpaceFrameMode;
  tokens: Partial<Record<SpaceToken, string>>;
  dark: boolean;
}

export function composeSpaceDocument(input: ComposeInput): string {
  const genreCss = input.genre === 'letter' ? LETTER_CSS : REPORT_CSS;
  const classes = `pz-${input.genre} pz-wait${input.mode === 'thumb' ? ' pz-thumb' : ''}`;
  const scheme = input.dark ? 'dark' : 'light';
  return '<!doctype html><html lang="zh-CN" class="pz-' + input.genre + '" style="color-scheme:' + scheme + '">'
    + `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SPACE_CSP}">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">'
    + `<style>${tokenCss(input.tokens)}${BASE_CSS}${genreCss}${input.mode === 'thumb' ? THUMB_CSS : ''}`
    + '[data-pz-highlight]{background:var(--tint2);border-radius:8px;scroll-margin:48px}</style>'
    + `<script>(${spaceRuntime.toString()})(${JSON.stringify(input.mode)});</script>`
    + `</head><body class="${classes}">${input.body}</body></html>`;
}
