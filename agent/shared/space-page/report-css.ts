// 报告的版式（第 13 批，照 Aaron 11-14 给的两份参考重做，他看过设计稿说「照稿做」）：顶上一行出处（陶土色的期号、
// 资料截至、读完要多久），结论大标题（54/62，<em> 陶土色）带一句导语，右边可以有一块深色的「核心判断」；数字条是带色顶边的
// 小卡；3 节以上带 id 的 section 由显示的一端在第一节前面配一条吸顶的横向目录（rp-nav，跟着滚动高亮）；每节左边是
// 「01 / 名字」、右边大标题和一句说明。研究类的块：大数字（rp-pulse / rp-big / rp-rail）、要点格（rp-points）、图加
// 旁注（rp-duo / rp-note）、案例（rp-cases）、步骤（rp-steps）、两两对照（rp-grid2）、待核实（rp-open）；核查类的块：
// 判定一览（rp-verdict）、逐条判定（rp-facts / rp-fact / rp-badge / rp-srcs）、改法（rp-fix）、算一笔（rp-num）、
// 时间线（rp-time）、几种决定（rp-dec）、给他的建议（rp-call）、页脚（rp-foot）。旧报告的类（cards2/cards3、rcard、
// paper、facts、chain、lst、cov、几种图、rt……）都留着，旧报告照常显示；旧报告写在大标题块里的出处行和数字条，显示时
// 挪到大标题上下（space-document.ts）。和 Plasticine 的规矩冲突的照 Plasticine：字重只用到 600（参考是 700），卡片只要
// --float 底 + 1px 细线、不加投影（参考的大数字卡、判定一览、提醒卡有投影）。类名写进给模型的说明
// （agent/src/subs/space-guide.ts），模型用现成的，不自己造。

export const REPORT_CSS = `
body.pz-report{background:var(--bg)}
.rp{width:100%;max-width:1120px;margin:0 auto;padding:0 48px 80px;font-size:16px;line-height:28px}
.rp-kick{display:flex;align-items:center;flex-wrap:wrap;gap:4px 14px;padding:22px 0 16px;
border-bottom:1px solid var(--line2);font-size:12px;line-height:18px;color:var(--fg2)}
.rp-kick b{font-weight:600;color:var(--accent)}
.rp-kick .end{margin-left:auto}
.rp-hero{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;align-items:end;padding:56px 0 44px}
.rp-hero:has(.rp-brief){grid-template-columns:minmax(0,1.3fr) minmax(260px,.7fr);gap:48px}
.rp-h1,.rp h1{font-size:54px;line-height:62px;font-weight:600;max-width:840px}
.rp-h1 em,.rp h1 em{font-weight:inherit;color:var(--accent)}
.rp-deck{font-size:19px;line-height:34px;color:var(--fg2);margin-top:22px;max-width:760px}
.rp-brief{padding:24px 26px;border-radius:4px 20px 4px 20px;background:var(--fg);color:var(--bg)}
.rp-brief .lb{font-size:11px;line-height:16px;font-weight:600;opacity:.62}
.rp-brief p{font-size:15px;line-height:27px;margin-top:10px}
.rp-brief p.lb{margin-top:0}
.rp-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 8px}
.rp-stat{padding:16px 20px 14px;background:var(--float);box-shadow:inset 0 0 0 1px var(--line);
border-top:3px solid var(--h,var(--hue-sky))}
.rp-stat:nth-child(4n+2){--h:var(--hue-teal)} .rp-stat:nth-child(4n+3){--h:var(--hue-ochre)}
.rp-stat:nth-child(4n+4){--h:var(--accent)}
.rp-stat .v{display:flex;align-items:baseline;gap:4px}
.rp-stat .v b{font-family:var(--mono);font-size:30px;line-height:38px;font-weight:600}
.rp-stat .v i{font-size:14px;color:var(--fg2)}
.rp-stat .l{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--fg2);margin-top:4px}
.rp-nav{position:sticky;top:0;z-index:5;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;margin:32px -48px 0;
padding:8px 48px;background:var(--bg);border-top:1px solid var(--line2);border-bottom:1px solid var(--line2)}
.rp-nav::-webkit-scrollbar{display:none}
.rp-nav a{flex:none;padding:5px 12px;border-radius:8px;font-size:13px;line-height:20px;color:var(--fg2);
text-decoration:none;white-space:nowrap;transition:background-color 120ms ease-out,color 120ms ease-out}
.rp-nav a:hover{color:var(--fg);background:var(--tint)}
.rp-nav a.on{color:var(--fg);background:var(--tint2);font-weight:500}
.rp-sec{padding:64px 0;scroll-margin-top:52px}
.rp-sec+.rp-sec{border-top:1px solid var(--line2)}
.rp-sh{display:grid;grid-template-columns:200px minmax(0,1fr);gap:4px 28px;align-items:start;margin-bottom:32px}
.rp-sh .no{font-family:var(--mono);font-size:12px;line-height:20px;font-weight:600;color:var(--accent);
padding-top:12px}
.rp-sh h2{font-size:38px;line-height:48px;font-weight:600}
.rp-sh p{grid-column:2;font-size:16px;line-height:28px;color:var(--fg2);max-width:760px}
.rp-sh:not(:has(>.no)){display:block}
.rp-sh:not(:has(>.no)) p{margin-top:8px}
.rp-sec>h2{font-size:30px;line-height:40px;font-weight:600;margin-bottom:18px}
.rp h3{font-size:18px;line-height:28px;font-weight:600}
.rp p+p{margin-top:12px}
/* 一节里块和块、块和段落之间的空：各块自己写了上边距的照它们自己的（这条零特异性在前面，后面的会盖过它）。 */
.rp-sec>:where(p,.rp-pulse,.rp-points,.rp-duo,.rp-cases,.rp-steps,.rp-grid2,.rp-open,.rp-verdict,.rp-fix,.rp-facts,
.rp-time,.rp-dec,.rp-call,.srcs,.cards2,.cards3,.rt,.lst,.cov,.chain,.filt)+:where(.rp-pulse,.rp-points,.rp-duo,
.rp-cases,.rp-steps,.rp-grid2,.rp-open,.rp-verdict,.rp-fix,.rp-facts,.rp-time,.rp-dec,.rp-call,.srcs,.cards2,.cards3,
.rt,.lst,.cov,.chain,.filt){margin-top:24px}
.rp-sec>:where(.rp-pulse,.rp-points,.rp-duo,.rp-cases,.rp-steps,.rp-grid2,.rp-open,.rp-verdict,.rp-fix,.rp-facts,
.rp-time,.rp-dec,.rp-call,.srcs,.cards2,.cards3,.rt,.lst,.cov,.chain,.filt)+p{margin-top:16px}
.rp .sub{font-size:14px;line-height:22px;color:var(--fg2)}
.rp-src{display:inline-flex;align-items:center;gap:4px;margin-top:12px;font-size:12px;line-height:18px;
color:var(--fg2);text-decoration:none}
.rp-src::after{content:"↗";color:var(--accent)}
.rp-src:hover{color:var(--fg)}
.rp-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px;line-height:20px;color:var(--fg2);
margin-bottom:14px}
.rp-meta a{color:var(--fg)}
.rp-pulse{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:20px;align-items:stretch}
.rp-big{display:flex;flex-direction:column;justify-content:space-between;gap:24px;min-height:320px;padding:30px 32px;
background:var(--float);border-radius:20px 4px 20px 4px;box-shadow:0 0 0 1px var(--line2)}
.rp-big>b{font-family:var(--mono);font-size:112px;line-height:104px;font-weight:600;color:var(--accent)}
.rp-big h3{font-size:21px;line-height:30px}
.rp-big p{margin-top:8px;color:var(--fg2)}
.rp-rail{display:grid;gap:12px;align-content:start}
.rp-points{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;margin-top:24px;
background:var(--line2);box-shadow:0 0 0 1px var(--line2)}
.rp-points>article{padding:22px 20px;background:var(--float);min-height:200px}
.rp-points .n,.rp-case .n{font-family:var(--mono);font-size:12px;line-height:16px;font-weight:600;color:var(--accent)}
.rp-points h3{font-size:17px;line-height:26px;margin:16px 0 8px}
.rp-points p{font-size:13px;line-height:22px;color:var(--fg2)}
.rp-duo{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr);gap:20px;align-items:start}
.rp-duo>.ch{margin:0}
.rp-note{padding:24px 26px;border-radius:16px;background:var(--float);box-shadow:0 0 0 1px var(--line2)}
.rp-note h3{margin-bottom:4px}
.rp-note ul{padding-left:18px;margin-top:10px}
.rp-note li{font-size:14px;line-height:24px;color:var(--fg2)}
.rp-note li+li{margin-top:10px}
.rp-note li b{color:var(--fg)}
.stt{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:4px;font-size:11px;
line-height:16px;font-weight:500;color:var(--fg2);background:var(--tint2);white-space:nowrap}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.filt{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:22px}
.filt>button{height:34px;padding:0 14px;border-radius:8px;font-size:13px;color:var(--fg2);
box-shadow:inset 0 0 0 1px var(--line2);display:inline-flex;align-items:center;gap:6px;
transition:background-color 120ms ease-out,color 120ms ease-out}
.filt>button:hover{color:var(--fg);box-shadow:inset 0 0 0 1px var(--fg2)}
.filt>button.on{background:var(--fg);color:var(--bg);box-shadow:none}
.filt>button .c{font-family:var(--mono);font-size:11px;opacity:.7}
.cards2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.cards3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.rcard{border:1px solid var(--line2);border-radius:12px;background:var(--float);padding:18px 20px 16px;display:flex;
flex-direction:column;gap:10px}
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
.rp-cases{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.rp-case{display:grid;grid-template-columns:52px minmax(0,1fr);gap:16px;padding:24px;border-radius:6px 18px 6px 18px;
background:var(--float);box-shadow:0 0 0 1px var(--line2)}
.rp-case .n{font-size:18px;line-height:24px;padding-top:2px}
.rp-case h3{font-size:20px;line-height:28px}
.rp-case .who{font-size:13px;line-height:20px;color:var(--fg2);margin:2px 0 12px}
.rp-case .hl{font-family:var(--mono);font-size:17px;line-height:26px;font-weight:600;color:var(--hue-sky);
margin:12px 0 8px}
.rp-case .tx{font-size:14px;line-height:23px;color:var(--fg2)}
.rp-case .take{font-size:14px;line-height:23px;margin-top:8px}
.rp-case .take b{color:var(--accent)}
.rp-case .cav{display:block;font-size:12px;line-height:18px;color:var(--fg3);margin-top:8px}
.rp-steps{display:grid;gap:12px;counter-reset:st}
.rp-steps>article{counter-increment:st;display:grid;grid-template-columns:72px minmax(180px,.7fr) minmax(0,1.3fr);
gap:24px;padding:26px;background:var(--float);box-shadow:0 0 0 1px var(--line2)}
.rp-steps>article::before{content:counter(st,decimal-leading-zero);font-family:var(--mono);font-size:24px;
line-height:28px;font-weight:600;color:var(--accent)}
.rp-steps .fit{font-size:12px;line-height:18px;font-weight:600;color:var(--hue-sky);margin-top:6px}
.rp-steps .two{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.rp-steps h4{font-size:13px;line-height:20px;font-weight:600;margin-bottom:4px}
.rp-steps .two p{font-size:14px;line-height:23px;color:var(--fg2)}
.rp-steps .risk h4{color:var(--accent)}
.rp-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line2);
box-shadow:0 0 0 1px var(--line2)}
.rp-grid2>article{padding:22px;background:var(--float)}
.rp-grid2 .tg{float:right;font-size:12px;line-height:20px;color:var(--accent)}
.rp-grid2 h3{font-size:17px;line-height:26px}
.rp-grid2 p{font-size:14px;line-height:23px;color:var(--fg2);margin-top:6px}
.rp-open{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.rp-open>article{padding:22px 24px;background:var(--float);border-left:4px solid var(--hue-ochre);
box-shadow:0 0 0 1px var(--line)}
.rp-open h3{font-size:17px;line-height:26px;margin-bottom:6px}
.rp-open p{font-size:14px;line-height:23px;color:var(--fg2)}
.rp-verdict{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));background:var(--float);
box-shadow:0 0 0 1px var(--line2)}
.rp-verdict>div{padding:18px 20px}
.rp-verdict>div+div{border-left:1px solid var(--line2)}
.rp-verdict b{display:block;font-family:var(--mono);font-size:30px;line-height:36px;font-weight:600}
.rp-verdict span{font-size:13px;line-height:20px;color:var(--fg2)}
.rp-badge{display:inline-flex;align-items:center;flex:none;height:24px;padding:0 10px;border-radius:12px;
font-size:12px;line-height:16px;font-weight:600;color:var(--h,var(--hue-sky));
background:color-mix(in srgb,var(--h,var(--hue-sky)) 13%,transparent)}
.rp-badge.ok{--h:var(--ok)} .rp-badge.part{--h:var(--hue-ochre)} .rp-badge.no{--h:var(--err)}
.rp-facts{display:grid;gap:16px}
.rp-fact{padding:22px 24px;background:var(--float);box-shadow:0 0 0 1px var(--line2)}
.rp-fact .top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:8px}
.rp-fact .top h3{font-size:19px;line-height:28px}
.rp-fact p{font-size:15px;line-height:26px}
.rp-fact p+p{margin-top:8px}
.rp-srcs{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}
.rp-srcs a{font-size:12px;line-height:18px;padding:4px 8px;border-radius:4px;color:var(--fg2);text-decoration:none;
background:var(--tint2)}
.rp-srcs a:hover{color:var(--fg)}
.rp-fix{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.rp-fix>div{padding:18px 20px;background:var(--float);box-shadow:0 0 0 1px var(--line2)}
.rp-fix s{display:block;font-weight:600;color:var(--err);text-decoration-thickness:1px;margin-bottom:6px}
.rp-fix span{color:var(--ok);font-size:15px;line-height:25px}
.rp-num{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:18px;margin:14px 0;
padding:16px 18px;background:var(--tint2);font-size:14px;line-height:22px}
.rp-num small{display:block;font-size:12px;color:var(--fg2)}
.rp-num b{font-family:var(--mono);font-size:24px;line-height:30px;font-weight:600;white-space:nowrap}
.rp-time{position:relative;padding-left:28px}
.rp-time::before{content:"";position:absolute;left:5px;top:8px;bottom:10px;width:2px;background:var(--line2)}
.rp-time>div{position:relative;padding:0 0 28px 16px}
.rp-time>div::before{content:"";position:absolute;left:-27px;top:6px;width:12px;height:12px;border-radius:50%;
background:var(--hue-sky);box-shadow:0 0 0 3px var(--bg)}
.rp-time time{font-size:13px;line-height:20px;font-weight:600;color:var(--hue-sky)}
.rp-time h3{font-size:17px;line-height:26px;margin-top:2px}
.rp-time p{font-size:14px;line-height:23px;color:var(--fg2);margin-top:4px}
.rp-dec{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.rp-dec>article{padding:20px;background:var(--float);border-top:4px solid var(--h,var(--hue-sky));
box-shadow:0 0 0 1px var(--line)}
.rp-dec>article:nth-child(3n+2){--h:var(--hue-ochre)} .rp-dec>article:nth-child(3n+3){--h:var(--ok)}
.rp-dec h3{font-size:17px;line-height:26px}
.rp-dec p{font-size:14px;line-height:23px;color:var(--fg2);margin-top:8px}
.rp-call{margin-top:20px;padding:22px 24px;background:var(--float);border-top:4px solid var(--hue-sky);
box-shadow:0 0 0 1px var(--line2)}
.rp-call h3{font-size:19px;line-height:28px;margin-bottom:6px}
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
.srcs{columns:2;column-gap:32px;margin-top:4px}
.srcs>a,.srcs>div{display:grid;grid-template-columns:24px minmax(0,1fr);gap:4px 8px;break-inside:avoid;padding:10px 0;
border-top:1px solid var(--line2);font-size:13px;line-height:20px;text-decoration:none}
.srcs .n{font-family:var(--mono);font-size:12px;color:var(--accent)}
.srcs .d{grid-column:2;font-size:12px;color:var(--fg3)}
.rp-foot{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:8px;padding-top:28px;
border-top:1px solid var(--line2);font-size:13px;line-height:22px;color:var(--fg2)}
.rp-foot b{color:var(--fg)}
.rp .rp-foot p+p{margin-top:0}
.ch{margin:24px 0 8px;padding:24px 26px 18px;border-radius:16px;background:var(--float);
box-shadow:0 0 0 1px var(--line2)}
.ch-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.ch-h b{font-size:18px;line-height:28px;font-weight:600}
.ch-h .meta{font-size:13px}
.ch-legend{display:flex;gap:16px;margin-left:auto;font-size:12px;line-height:18px;color:var(--fg2)}
.ch-legend span{display:inline-flex;align-items:center;gap:6px}
.lg-sq{width:9px;height:9px;background:var(--h,var(--hue-sky))}
.lg-ring{width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--fg2)}
.lg-dot{width:10px;height:10px;border-radius:50%;background:var(--hue-sky)}
.ch-src{font-size:12px;line-height:18px;color:var(--fg2);margin-top:12px;padding-top:10px;
border-top:1px solid var(--line)}
.ch svg{display:block;width:100%;height:auto;overflow:visible}
.ch svg text{font-family:var(--mono);font-size:11px;fill:var(--fg3)}
.brow,.ax{display:grid;grid-template-columns:120px minmax(0,1fr) 64px;align-items:center;gap:12px}
.brow{height:40px}
.brow .bl{font-size:13px;line-height:18px;color:var(--fg)}
.drow .bl,.crow .bl{font-size:13px;line-height:18px;color:var(--fg2)}
.brow .bv{font-family:var(--mono);font-size:13px;color:var(--fg);text-align:right}
.brow .bv i{display:block;font-size:11px;line-height:14px;color:var(--fg3)}
.track,.dtrack,.ctrack{position:relative;height:100%}
.track .gl,.dtrack .gl,.ctrack .gl{position:absolute;top:0;bottom:0;width:1px;background:var(--line)}
.ctrack .gl.z{background:var(--line2)}
.track .b{position:absolute;left:0;top:13px;height:14px;border-radius:0 3px 3px 0;background:var(--hue-sky)}
.track:has(.b2) .b{top:9px}
.track .b2{position:absolute;left:0;top:26px;height:7px;border-radius:0 3px 3px 0;background:var(--accent)}
.track .b.lo{background:color-mix(in srgb,var(--hue-sky) 38%,transparent)}
.track .wh{position:absolute;top:19px;height:2px;background:var(--fg)}
.track .wh::before,.track .wh::after{content:"";position:absolute;top:-4px;width:1.5px;height:10px;
background:var(--fg)}
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
.rp{padding:0 18px 40px}
.rp-kick{padding:14px 0 12px;gap:2px 10px}
.rp-kick .end{display:none}
.rp-hero,.rp-hero:has(.rp-brief){grid-template-columns:minmax(0,1fr);gap:24px;padding:32px 0 26px}
.rp-h1,.rp h1{font-size:34px;line-height:42px}
.rp-deck{font-size:16px;line-height:28px;margin-top:14px}
.rp-brief{padding:18px 20px}
.rp-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.rp-stat{padding:12px 14px 10px}
.rp-stat .v b{font-size:24px;line-height:30px}
.rp-nav{margin:24px -18px 0;padding:8px 18px}
.rp-sec{padding:44px 0}
.rp-sh{display:block;margin-bottom:22px}
.rp-sh .no{padding-top:0}
.rp-sh h2{font-size:28px;line-height:36px;margin-top:6px}
.rp-sh p{margin-top:10px;font-size:15px;line-height:26px}
.rp-sec>h2{font-size:24px;line-height:32px}
.rp-pulse,.rp-duo,.rp-cases,.rp-grid2,.rp-open,.cards2,.cards3,.cov{grid-template-columns:minmax(0,1fr)}
.cards2,.cards3,.cov{gap:12px}
.rp-big{min-height:0;padding:22px}
.rp-big>b{font-size:76px;line-height:76px}
.rp-points{grid-template-columns:minmax(0,1fr)}
.rp-points>article{min-height:0;padding:18px}
.rp-case{grid-template-columns:36px minmax(0,1fr);gap:10px;padding:18px}
.rp-steps>article{grid-template-columns:minmax(0,1fr);gap:12px;padding:20px}
.rp-steps>article::before{font-size:14px;line-height:20px}
.rp-steps .two{grid-template-columns:minmax(0,1fr);gap:14px}
.rp-fact{padding:18px}
.rp-fact .top{display:block}
.rp-fact .top .rp-badge{margin-top:10px}
.rp-num{display:block}
.rp-num b{display:block;margin-top:6px;white-space:normal}
.rp-verdict{grid-template-columns:repeat(2,minmax(0,1fr))}
.rp-verdict>div:nth-child(odd){border-left:0}
.rp-verdict>div:nth-child(n+3){border-top:1px solid var(--line2)}
.rcard{padding:16px}
.brow,.ax{grid-template-columns:76px minmax(0,1fr) 52px}
.drow,.dax{grid-template-columns:64px minmax(0,1fr) 92px}
.crow,.cax{grid-template-columns:110px minmax(0,1fr) 92px}
.facts{grid-template-columns:repeat(2,minmax(0,1fr))}
.facts>div:nth-child(odd){padding-left:0;border-left:0}
.ch,.rp-note{padding:18px}
.rt{font-size:13px}
.srcs{columns:1}
.rp-foot{grid-template-columns:minmax(0,1fr);gap:12px}
}
`;
