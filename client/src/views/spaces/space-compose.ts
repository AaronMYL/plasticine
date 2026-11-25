import type { SpaceGenre } from '../../api/shared.ts';
import { BASE_CSS, tokenCss, type SpaceToken } from '../../../../agent/shared/space-page/base-css.ts';
import { LETTER_CSS } from '../../../../agent/shared/space-page/letter-css.ts';
import { REPORT_CSS } from '../../../../agent/shared/space-page/report-css.ts';
import { spaceCharts } from './space-charts.ts';
import { spaceRuntime, type SpaceFrameMode } from './space-runtime.ts';

export const SPACE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
  + "img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; form-action 'none'; "
  + "base-uri 'none'";

const THUMB_CSS = `
body.pz-thumb{overflow:hidden}
body.pz-thumb .rp-nav{display:none}
body.pz-thumb .rp{max-width:none;padding:0 80px}
body.pz-thumb .rp-kick{font-size:22px;line-height:32px;padding:32px 0 24px}
body.pz-thumb .rp-hero{padding:56px 0 40px}
body.pz-thumb .rp-h1{font-size:64px;line-height:76px;max-width:1000px}
body.pz-thumb .rp-deck{font-size:28px;line-height:42px}
body.pz-thumb .rp-stat .v b{font-size:48px;line-height:60px}
body.pz-thumb .rp-stat .l{font-size:22px;line-height:30px}
body.pz-thumb .lt{max-width:960px;padding-top:64px}
body.pz-thumb .lt-date{font-size:26px;line-height:36px}
body.pz-thumb .lt-title{font-size:92px;line-height:108px}
body.pz-thumb .lt-body{font-size:26px;line-height:44px}
body.pz-thumb .lt-body>p.lt-lead{display:none}
body.pz-thumb .lt-fig{margin:40px 0 0}
body.pz-thumb .lt-fig::before{display:none}
body.pz-thumb .lt-fig img{height:300px;aspect-ratio:auto;border-radius:20px;transform:none}
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
    + '[data-pz-highlight]{background:var(--tint2);border-radius:8px;scroll-margin:48px}'
    + 'body:not(.pz-thumb) img{cursor:zoom-in}body:not(.pz-thumb) a img{cursor:pointer}</style>'
    + `<script>(${spaceRuntime.toString()})(${JSON.stringify(input.mode)});</script>`
    + `<script>(${spaceCharts.toString()})();</script>`
    + `</head><body class="${classes}">${input.body}</body></html>`;
}
