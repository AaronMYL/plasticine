// 来信的信纸（第 13 批，照 Aaron 11-14 给的参考重做，他看过设计稿说「照稿做」）：纸色 --bubble；正文 Geist + 系统中文；
// 日期、题目、图注、原话、几件事、几个数和署名用霞鹜文楷（按需加载），题目、数和署名陶土色，署名靠右；插图像贴在信上的
// 照片（白边、圆角、微斜、一条胶带），原话是一张贴上去的小纸片；重点一句用 <mark> 像荧光笔划过，链接是虚线。信纸是固定的：
// 日期、题目、署名由显示的一端套上，模型只写正文（第一段 lt-lead、插图 lt-fig、其余段落）。11-12 加的三样照旧：他的原话
// （lt-quote）、这封信里的几件事（lt-notes）、两三个数（lt-facts）。11-14：不画线稿（出不了图就不配图）；AI 画的图右上角
// 一个 ✦ 小标（lt-ai，悬停写「AI 生成」）。阴影用固定的暗色：深色时令牌里的 --fg 是浅色，拿它做阴影会发白。

const SPARK = "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m8 1.5 1.7 4.8L14.5 8l-4.8 "
  + "1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z' fill='black'/%3E%3C/svg%3E";

/** 图上表示「这张是 AI 画的」的小标；出图那一端插在 img 后面，显示的一端给旧信补上。 */
export const LETTER_AI_MARK = '<span class="lt-ai" role="img" aria-label="AI 生成" title="AI 生成"></span>';

export const LETTER_CSS = `
html.pz-letter,body.pz-letter{background:var(--bubble)}
.lt{max-width:640px;margin:0 auto;padding:96px 0 112px}
.lt-date{text-align:center;font-family:var(--wenkai);font-size:18px;line-height:26px;color:var(--fg2)}
.lt-title{font-family:var(--wenkai);font-weight:400;font-size:64px;line-height:74px;text-align:center;margin-top:14px;
color:var(--accent)}
.lt-body{font-size:17px;line-height:32px;color:var(--fg)}
.lt-body>p,.lt-body>ul,.lt-body>ol,.lt-body>blockquote{margin-top:24px}
.lt-body>p.lt-lead,.lt-lead{font-size:22px;line-height:38px;font-weight:600;margin-top:44px}
.lt-body blockquote:not(.lt-quote){border-left:1px solid var(--fg3);padding-left:14px;color:var(--fg2)}
.lt-body mark{color:inherit;padding:.04em .16em;margin:0 -.04em;border-radius:2px;-webkit-box-decoration-break:clone;
box-decoration-break:clone;background:linear-gradient(103deg,transparent .5%,color-mix(in srgb,var(--accent) 22%,
transparent) .5% 96%,transparent 96%)}
.lt-body a{color:var(--fg);text-decoration:none;padding-bottom:2px;
background:repeating-linear-gradient(90deg,var(--accent) 0 4px,transparent 4px 7px) 0 100%/100% 1.5px no-repeat}
.lt-body a:hover{color:var(--accent)}
.lt-fig{position:relative;margin:48px -60px 8px}
.lt-fig::before{content:"";position:absolute;z-index:1;left:15%;top:-12px;width:104px;height:30px;border-radius:2px;
background:color-mix(in srgb,var(--float) 72%,transparent);box-shadow:0 1px 2px rgba(31,24,18,.08);
transform:rotate(-4deg)}
.lt-fig img{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:cover;border:6px solid var(--float);
border-radius:26px;transform:rotate(1deg);box-shadow:0 2px 2px rgba(31,24,18,.07),0 10px 28px rgba(31,24,18,.11)}
.lt-fig svg{display:block;width:100%;height:auto}
.lt-ai{position:absolute;top:20px;right:22px;width:28px;height:28px;border-radius:50%;
background:color-mix(in srgb,var(--float) 88%,transparent);transform:rotate(1deg)}
.lt-ai::after{content:"";position:absolute;inset:7px;background:var(--fg2);
-webkit-mask:url("data:image/svg+xml,${SPARK}") center/contain no-repeat;
mask:url("data:image/svg+xml,${SPARK}") center/contain no-repeat}
.lt-fig figcaption{font-family:var(--wenkai);font-size:20px;line-height:28px;color:var(--fg);text-align:center;
margin-top:18px;transform:rotate(1deg)}
.lt-body>.lt-quote,.lt-quote{position:relative;margin:48px 12px 12px;padding:26px 30px 20px;border:0;
border-radius:16px;background:var(--float);box-shadow:0 0 0 1px var(--line2),0 16px 30px -24px rgba(31,24,18,.45);
font-family:var(--wenkai);font-size:26px;line-height:40px;color:var(--fg);transform:rotate(-.6deg)}
.lt-quote::before{content:"";position:absolute;left:50%;top:-11px;width:88px;height:22px;border-radius:2px;
background:color-mix(in srgb,var(--bubble) 55%,var(--float));box-shadow:0 1px 2px rgba(31,24,18,.08);
transform:translateX(-50%) rotate(-2deg)}
.lt-quote cite{display:block;font-family:var(--sans);font-style:normal;font-size:13px;line-height:20px;
color:var(--fg3);margin-top:12px}
.lt-quote cite a{color:var(--fg2)}
.lt-body>.lt-notes,.lt-notes{list-style:none;padding:0;margin-top:32px;border-top:1px solid var(--line2)}
.lt-notes li{display:flex;gap:18px;padding:12px 0;line-height:28px;border-bottom:1px solid var(--line2)}
.lt-notes li>b{flex:none;min-width:3.4em;font-family:var(--wenkai);font-weight:400;font-size:20px;color:var(--accent)}
.lt-facts{display:flex;gap:56px;justify-content:center;margin-top:40px}
.lt-facts>div{text-align:center}
.lt-facts b{display:block;font-family:var(--wenkai);font-weight:400;font-size:56px;line-height:64px;
color:var(--accent)}
.lt-facts span{font-family:var(--wenkai);font-size:18px;line-height:26px;color:var(--fg2)}
.lt-sign{display:flex;align-items:center;justify-content:flex-end;gap:14px;margin-top:52px;font-family:var(--wenkai);
font-size:40px;line-height:48px;color:var(--accent)}
.lt-sign svg{width:34px;height:34px;flex:none}
.plasticine-mark-blob{fill:var(--accent)} .plasticine-mark-swirl{stroke:var(--bubble)}
@media (max-width:760px){
.lt{padding:36px 24px 48px}
.lt-date{font-size:15px;line-height:22px}
.lt-title{font-size:44px;line-height:52px}
.lt-body{font-size:16px;line-height:29px}
.lt-body>p.lt-lead,.lt-lead{font-size:19px;line-height:32px;margin-top:28px}
.lt-fig{margin:36px 0 4px}
.lt-fig img{border-width:5px;border-radius:16px}
.lt-fig::before{width:72px;height:24px;top:-10px}
.lt-ai{top:14px;right:14px;width:24px;height:24px}
.lt-ai::after{inset:6px}
.lt-fig figcaption{font-size:17px;line-height:24px;margin-top:14px}
.lt-body>.lt-quote,.lt-quote{font-size:21px;line-height:34px;margin:40px 4px 8px;padding:22px 20px 16px}
.lt-facts{gap:32px}
.lt-facts b{font-size:42px;line-height:50px}
.lt-facts span{font-size:15px;line-height:22px}
.lt-sign{font-size:32px;line-height:40px;margin-top:40px}
.lt-sign svg{width:28px;height:28px}
}
`;
