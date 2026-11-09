// 空间网页的底子（第 8 批第 6 条，设计稿 11-09 他确认）：令牌、字体、重置、图标、改字时的样子。报告和来信的样式在
// report-css.ts、letter-css.ts。iframe 是另一份文档，拿不到 Plasticine 页面上的令牌：外面打开时把当前的令牌值传进来
// （SPACE_TOKENS 里这几个名字），深浅色切换时再传一次；这里的值只是没传时的浅色兜底，和 client/src/tokens.css 一致。

/** 外面要同步进 iframe 的令牌（--float 在外面叫 --layer-float）。 */
export const SPACE_TOKENS = ['--bg', '--fg', '--fg2', '--fg3', '--line', '--line2', '--tint', '--tint2', '--accent',
  '--run', '--ok', '--err', '--bubble', '--float', '--hue-clay', '--hue-ochre', '--hue-teal', '--hue-sky', '--hue-rose',
  '--hue-olive', '--hue-slate', '--hue-sage'] as const;
export type SpaceToken = (typeof SPACE_TOKENS)[number];

export const SPACE_LIGHT_TOKENS: Readonly<Record<SpaceToken, string>> = {
  '--bg': '#fcf9f6', '--fg': '#2a2622', '--fg2': '#6b635b', '--fg3': '#a1988f', '--line': 'rgba(42, 38, 34, 0.07)',
  '--line2': 'rgba(42, 38, 34, 0.16)', '--tint': 'rgba(110, 74, 46, 0.045)', '--tint2': 'rgba(110, 74, 46, 0.075)',
  '--accent': '#a1674e', '--run': '#5a6b85', '--ok': '#587559', '--err': '#a9483a', '--bubble': '#f0eae3',
  '--float': '#fefdfa', '--hue-clay': '#a15b3d', '--hue-ochre': '#8a6622', '--hue-teal': '#2f7a6e',
  '--hue-sky': '#3a72a3', '--hue-rose': '#a65067', '--hue-olive': '#6b7230', '--hue-slate': '#5a6b85',
  '--hue-sage': '#587559',
};

/** 文楷在 iframe 里的字体名（外面按用到的字分片传进来）。 */
export const WENKAI_FAMILY = 'Plasticine WenKai';

// 图标（和 Plasticine 的 Icon 同一套 16 格线条）用 CSS 遮罩画：模型写 <i class="i-ok"></i> 就行，不用自己画 SVG。
const ICONS: Readonly<Record<string, string>> = {
  ok: '<path d="m3 8 3 3 7-7"/>',
  no: '<path d="m4 4 8 8M12 4l-8 8"/>',
  arrow: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  alert: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.8M8 11.1h.01"/>',
  link: '<path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5V13a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 3 13V5a.5.5 0 0 1 .5-.5H7"/>',
};

function iconCss(): string {
  return Object.entries(ICONS).map(([name, path]) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="black" '
      + `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    return `.i-${name}{-webkit-mask-image:${url};mask-image:${url}}`;
  }).join('\n');
}

export function tokenCss(values: Partial<Record<SpaceToken, string>>): string {
  const merged = { ...SPACE_LIGHT_TOKENS, ...values };
  return `:root{${Object.entries(merged).map(([name, value]) => `${name}:${value}`).join(';')}}`;
}

export const BASE_CSS = `
:root{--sans:Geist,'PingFang SC',MiSans,'Microsoft YaHei',system-ui,sans-serif;
--mono:'Geist Mono','SF Mono',ui-monospace,Menlo,Consolas,monospace;
--wenkai:'${WENKAI_FAMILY}','LXGW WenKai','Kaiti SC','STKaiti',KaiTi,var(--sans)}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);color:var(--fg);-webkit-text-size-adjust:100%;scrollbar-width:thin;
scrollbar-color:var(--line2) transparent}
body{margin:0;font-family:var(--sans);font-size:16px;line-height:28px;-webkit-font-smoothing:antialiased;
font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
:where(h1,h2,h3,h4,h5,p,ul,ol,dl,dd,figure,blockquote){margin:0}
:where(ul,ol){padding-left:1.4em}
a{color:inherit;text-decoration:underline;text-decoration-color:var(--line2);text-underline-offset:3px}
a:hover{text-decoration-color:var(--fg2)}
a[data-link]{cursor:pointer}
b,strong{font-weight:600}
i{font-style:normal}
em{font-style:normal;font-weight:500}
img,svg{max-width:100%}
img{height:auto;display:block}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
code,kbd{font-family:var(--mono);font-size:.9em}
.mono{font-family:var(--mono)}
.f2{color:var(--fg2)} .f3{color:var(--fg3)}
.meta{font-size:12px;line-height:18px;color:var(--fg2)}
.wk{font-family:var(--wenkai);font-weight:400}
.i-ok,.i-no,.i-arrow,.i-alert,.i-link{display:inline-block;width:14px;height:14px;flex:none;vertical-align:-2px;
background:currentColor;-webkit-mask-size:100% 100%;mask-size:100% 100%}
.i-ok{color:var(--ok)} .i-no{color:var(--err)} .i-arrow{color:var(--fg3)} .i-alert{color:var(--err)}
${iconCss()}
.sq{width:9px;height:9px;border-radius:2px;flex:none;background:var(--h,var(--fg));display:inline-block}
.sq.pre{background:repeating-linear-gradient(135deg,var(--h,var(--hue-ochre)) 0 1.5px,transparent 1.5px 3.5px);
box-shadow:inset 0 0 0 1px var(--h,var(--hue-ochre))}
.sq.watch{background:transparent;box-shadow:inset 0 0 0 1.5px var(--fg3)}
.seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--tint2);gap:2px}
.seg button{height:26px;padding:0 12px;border-radius:6px;font-size:13px;line-height:18px;color:var(--fg2);
display:inline-flex;align-items:center;gap:6px}
.seg button.on{background:var(--bg);color:var(--fg);box-shadow:0 0 0 1px var(--line2)}
.seg .c{font-family:var(--mono);font-size:11px;color:var(--fg3)}
[data-filter-hidden]{display:none!important}
::selection{background:color-mix(in srgb,var(--hue-sky) 26%,transparent)}
@media (prefers-reduced-motion:no-preference){body{transition:opacity 120ms ease-out}}
body.pz-wait{opacity:0}
/* 改字（✎）：能改的字悬停浅底，正在改的那一段 1.5px 墨线框；图表和数字条不能手改，淡下去。 */
body.pz-editing [data-e]{border-radius:6px;outline:none;transition:background-color 120ms ease-out;cursor:text}
body.pz-editing [data-e]:hover{background:var(--tint)}
body.pz-editing [data-e]:focus{outline:1.5px solid var(--fg);outline-offset:4px;background:var(--bg)}
body.pz-editing .pz-fixed{pointer-events:none}
body.pz-editing figure.pz-fixed,body.pz-editing svg.pz-fixed{opacity:.45}
`;
