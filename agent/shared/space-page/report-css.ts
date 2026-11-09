// 报告的版式（设计稿 Report / Report-Page / Phone-Report，11-09 他确认）：Geist + 系统中文、暖米 / 暖炭黑；结论大标题
// （报告专用 40/52）、数字条、结论卡（支持 / 不能读成）、可筛选的卡片、真数据图、对照表、来源索引、右侧目录。卡片 --float
// 底 + 1px 细线、无阴影。类名写进给模型的说明（agent/src/subs/space-guide.ts），模型用现成的，不自己造。

export const REPORT_CSS = `
body.pz-report{background:var(--bg)}
.rp{width:100%;max-width:1016px;margin:0 auto;padding:0 48px 96px;font-size:16px;line-height:28px}
.rp-hero{padding-top:56px}
.rp-kick{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px;font-size:13px;line-height:20px;color:var(--fg2)}
.rp-kick b{font-weight:500;color:var(--fg)}
.rp-h1,.rp h1{font-size:40px;line-height:52px;font-weight:600;margin-top:14px;max-width:840px}
.rp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-top:36px;
border-top:1px solid var(--fg)}
.rp-stat{padding:14px 20px 4px;border-left:1px solid var(--line2)}
.rp-stat:first-child{border-left:0;padding-left:0}
.rp-stat .v{display:flex;align-items:baseline;gap:4px}
.rp-stat .v b{font-family:var(--mono);font-size:32px;line-height:40px;font-weight:500}
.rp-stat .v i{font-size:14px;color:var(--fg2)}
.rp-stat .l{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--fg2);margin-top:2px}
.rp-body{display:grid;grid-template-columns:minmax(0,1fr) 176px;gap:64px;margin-top:8px}
.rp-body.no-toc{grid-template-columns:minmax(0,1fr)}
.rp-toc nav{position:sticky;top:24px;display:flex;flex-direction:column;font-size:13px;line-height:20px;
padding-top:44px}
.rp-toc a{padding:5px 0 5px 13px;border-left:1px solid var(--line2);color:var(--fg2);text-decoration:none}
.rp-toc a:hover{color:var(--fg)}
.rp-toc a.on{border-left:2px solid var(--fg);padding-left:12px;color:var(--fg);font-weight:500}
.rp-sec{padding-top:44px;scroll-margin-top:8px}
.rp-sec+.rp-sec{margin-top:12px;border-top:1px solid var(--line)}
.rp-sh{display:flex;align-items:baseline;gap:12px;margin-bottom:14px}
.rp-sh .no{font-family:var(--mono);font-size:13px;line-height:20px;color:var(--fg3);flex:none}
.rp-sh h2,.rp-sec>h2{font-size:24px;line-height:32px;font-weight:600}
.rp-sec>h2{margin-bottom:14px}
.rp h3{font-size:17px;line-height:26px;font-weight:600}
.rp p+p{margin-top:12px}
.rp .sub{font-size:14px;line-height:22px;color:var(--fg2)}
.rp-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px;line-height:20px;color:var(--fg2);
margin-bottom:14px}
.rp-meta a{color:var(--fg)}
.stt{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:6px;font-size:12px;
line-height:16px;font-weight:500;color:var(--fg);background:var(--tint2);white-space:nowrap}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.cards2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.cards3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.rcard{border:1px solid var(--line2);border-radius:12px;background:var(--float);padding:18px 20px 16px;
display:flex;flex-direction:column;gap:10px}
.rcard .tx{font-size:14px;line-height:22px;color:var(--fg2)}
.vd{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;padding-top:12px;margin-top:2px;
border-top:1px solid var(--line);font-size:13px;line-height:20px}
.vd dt{display:flex;align-items:center;gap:4px;color:var(--fg2);white-space:nowrap}
.vd dd{margin:0}
.paper{border:1px solid var(--line2);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:8px;
background:var(--float)}
.paper h4{font-size:15px;line-height:24px;font-weight:600}
.paper .en{font-size:13px;line-height:20px;color:var(--fg2)}
.paper .nx{font-size:13px;line-height:20px;color:var(--fg2);padding-top:8px;border-top:1px solid var(--line)}
.paper .nx b{color:var(--fg);font-weight:500}
.paper.dim{background:transparent;border-style:dashed}
.filt{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));border-top:1px solid var(--line);
border-bottom:1px solid var(--line);margin:18px 0 6px}
.facts>div{padding:12px 16px 12px 0}
.facts>div+div{padding-left:16px;border-left:1px solid var(--line)}
.facts b{display:block;font-family:var(--mono);font-size:20px;line-height:28px;font-weight:500}
.facts span{font-size:12px;line-height:18px;color:var(--fg2)}
.byai{border-left:1px solid var(--fg3);padding-left:14px;margin-top:20px}
.chain{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px;line-height:20px;margin:6px 0 2px}
.chain span{padding:3px 10px;border-radius:6px;background:var(--tint2)}
.lst{display:flex;flex-direction:column;gap:10px;margin-top:4px}
.lst>div,.lst>li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:8px;font-size:15px;line-height:24px}
.lst>div>i,.lst>li>i{padding-top:5px}
.lst i.bu{width:5px;height:5px;border-radius:50%;background:var(--fg3);margin:10px 0 0 6px;padding:0}
.cov{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px;margin-top:10px}
.cov>div{display:flex;align-items:center;gap:10px;min-height:36px;border-bottom:1px solid var(--line);font-size:14px}
.cov .r{margin-left:auto;font-size:12px;color:var(--fg2)}
.srcs{display:flex;flex-direction:column;margin-top:4px}
.srcs>a,.srcs>div{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:10px;align-items:baseline;
padding:8px 0;border-bottom:1px solid var(--line);font-size:14px;line-height:22px;text-decoration:none}
.srcs .n{font-family:var(--mono);font-size:12px;color:var(--fg3)}
.srcs .d{font-size:12px;color:var(--fg3)}
/* 图表：figure.ch 一框；横条（.brow）、哑铃（.drow）、相关（.crow）、时间段（.tl）是现成的，别的画法用内联 SVG。 */
.ch{margin:24px 0 8px;padding:18px 20px 14px;border:1px solid var(--line2);border-radius:12px}
.ch-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.ch-h b{font-size:15px;line-height:24px;font-weight:600}
.ch-h .meta{font-size:13px}
.ch-legend{display:flex;gap:16px;margin-left:auto;font-size:12px;line-height:18px;color:var(--fg2)}
.ch-legend span{display:inline-flex;align-items:center;gap:6px}
.ch-src{font-size:12px;line-height:18px;color:var(--fg2);margin-top:12px;padding-top:10px;
border-top:1px solid var(--line)}
.ch svg{display:block;width:100%;height:auto;overflow:visible}
.ch svg text{font-family:var(--mono);font-size:11px;fill:var(--fg3)}
.brow,.ax{display:grid;grid-template-columns:120px minmax(0,1fr) 64px;align-items:center;gap:12px}
.brow{height:34px}
.brow .bl,.drow .bl,.crow .bl{font-size:13px;line-height:18px;color:var(--fg2)}
.brow .bv{font-family:var(--mono);font-size:13px;color:var(--fg);text-align:right}
.brow .bv i{color:var(--fg3)}
.track,.dtrack,.ctrack{position:relative;height:100%}
.track .gl,.dtrack .gl,.ctrack .gl{position:absolute;top:0;bottom:0;width:1px;background:var(--line)}
.ctrack .gl.z{background:var(--line2)}
.track .b{position:absolute;left:0;top:11px;height:12px;border-radius:0 4px 4px 0;background:var(--hue-sky)}
.track .b.lo{background:color-mix(in srgb,var(--hue-sky) 38%,transparent)}
.track .wh{position:absolute;top:16px;height:2px;background:var(--fg)}
.track .wh::before,.track .wh::after{content:"";position:absolute;top:-4px;width:1.5px;height:10px;background:var(--fg)}
.track .wh::before{left:0} .track .wh::after{right:0}
.tk{position:relative;height:18px;font-family:var(--mono);font-size:11px;line-height:18px;color:var(--fg3)}
.tk span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.drow,.dax{display:grid;grid-template-columns:96px minmax(0,1fr) 132px;gap:12px}
.drow{align-items:center;height:52px}
.drow .dv,.crow .dv{font-size:13px;line-height:18px;text-align:right}
.drow .dv b{font-family:var(--mono);font-weight:500}
.drow .dv span{display:block;font-size:12px;color:var(--fg2)}
.dtrack .ln{position:absolute;top:25px;height:2px;background:var(--fg3)}
.dot{position:absolute;top:20px;width:12px;height:12px;border-radius:50%;margin-left:-6px;background:var(--bg);
box-shadow:inset 0 0 0 2px var(--fg2)}
.dot.f{background:var(--hue-sky);box-shadow:0 0 0 2px var(--bg)}
.dot .lb{position:absolute;top:-19px;left:50%;transform:translateX(-50%);font-family:var(--mono);font-size:11px;
line-height:14px;color:var(--fg2);white-space:nowrap}
.lg-ring{width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--fg2)}
.lg-dot{width:10px;height:10px;border-radius:50%;background:var(--hue-sky)}
.crow,.cax{display:grid;grid-template-columns:200px minmax(0,1fr) 150px;gap:12px}
.crow{align-items:center;height:38px}
.crow .dv{font-family:var(--mono);font-size:12px}
.crow .dv i{color:var(--fg2)}
.ctrack .dot{top:13px}
.tl{position:relative;height:96px;margin-top:4px}
.tl .base{position:absolute;left:0;right:0;top:60px;height:1px;background:var(--line2)}
.tl .span{position:absolute;top:48px;height:24px;border-radius:4px;
background:color-mix(in srgb,var(--hue-sky) 30%,transparent);box-shadow:inset 0 0 0 1px var(--hue-sky)}
.tl .span.pre{background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--hue-ochre) 45%,transparent) 0 2px,
transparent 2px 6px);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--hue-ochre) 70%,transparent)}
.tl .cap{position:absolute;top:0;font-size:12px;line-height:18px;color:var(--fg);white-space:nowrap;padding-left:2px}
.tl .cap span{display:block;color:var(--fg2)}
.tl .t{position:absolute;top:78px;font-family:var(--mono);font-size:11px;line-height:16px;color:var(--fg3);
transform:translateX(-50%)}
.rt{width:100%;border-collapse:collapse;font-size:14px;line-height:22px;margin-top:6px}
.rt th{font-size:12px;line-height:18px;font-weight:500;color:var(--fg2);text-align:left;padding:0 12px 8px 0;
border-bottom:1px solid var(--fg)}
.rt td{padding:10px 12px 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
.rt td:first-child{font-weight:500}
.rt td.f2{color:var(--fg2)}
.rp figure.img{margin:24px 0 8px}
.rp figure.img img{border-radius:12px}
.rp figure.img figcaption{font-size:12px;line-height:18px;color:var(--fg2);margin-top:8px}
@media (max-width:760px){
.rp{padding:0 20px 40px}
.rp-hero{padding-top:12px}
.rp-kick{font-size:12px;line-height:18px;gap:2px 8px}
.rp-h1,.rp h1{font-size:26px;line-height:36px;margin-top:10px}
.rp-stats{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:22px}
.rp-stat{padding:10px 0 10px 14px}
.rp-stat:nth-child(odd){border-left:0;padding-left:0}
.rp-stat:nth-child(n+3){border-top:1px solid var(--line)}
.rp-stat .v b{font-size:26px;line-height:34px}
.rp-body{grid-template-columns:minmax(0,1fr)}
.rp-toc{display:none}
.rp-sec{padding-top:28px}
.rp-sh h2,.rp-sec>h2{font-size:20px;line-height:28px}
.cards2,.cards3,.cov{grid-template-columns:minmax(0,1fr);gap:12px}
.rcard{padding:16px}
.brow,.ax{grid-template-columns:84px minmax(0,1fr) 56px}
.drow,.dax{grid-template-columns:64px minmax(0,1fr) 92px}
.crow,.cax{grid-template-columns:110px minmax(0,1fr) 92px}
.facts{grid-template-columns:repeat(2,minmax(0,1fr))}
.facts>div:nth-child(odd){padding-left:0;border-left:0}
.rt{font-size:13px}
}
`;
