// 来信的信纸（设计稿 Letter / Phone-Letter，11-09 他确认）：纸色 --bubble；正文 Geist + 系统中文；题目、图注、署名用
// 霞鹜文楷（按需加载）；题目墨色，只有署名前的 Plasticine 标记带陶土色；一张插图。信纸是固定的：日期、题目、署名由
// 显示的一端套上，模型只写正文（第一段 lt-lead、插图 lt-fig、其余段落）。11-12 加三样让信有他自己的东西：
// 他的原话（lt-quote）、这封信里的几件事（lt-notes）、两三个数（lt-facts）；出不了图时模型自己画一张线稿（svg.lt-draw）。

export const LETTER_CSS = `
html.pz-letter,body.pz-letter{background:var(--bubble)}
.lt{max-width:600px;margin:0 auto;padding:72px 0 88px}
.lt-date{text-align:center;font-size:13px;line-height:20px;color:var(--fg2)}
.lt-title{font-family:var(--wenkai);font-weight:400;font-size:48px;line-height:60px;text-align:center;margin-top:12px;
color:var(--fg)}
.lt-body{font-size:16px;line-height:30px}
.lt-body>p,.lt-body>ul,.lt-body>ol,.lt-body>blockquote{margin-top:22px}
.lt-body>p.lt-lead,.lt-lead{font-size:19px;line-height:34px;font-weight:500;margin-top:36px}
.lt-body blockquote{border-left:1px solid var(--fg3);padding-left:14px;color:var(--fg2)}
.lt-fig{margin:36px -60px 8px}
.lt-fig img,.lt-fig svg{display:block;width:100%;height:360px;object-fit:cover;border-radius:12px}
.lt-fig figcaption{font-family:var(--wenkai);font-size:17px;line-height:26px;color:var(--fg2);text-align:center;
margin-top:14px}
.lt-fig svg.lt-draw{height:auto;max-height:320px;object-fit:contain;border-radius:0}
.lt-quote{font-family:var(--wenkai);font-size:24px;line-height:38px;text-align:center;margin:40px 24px 8px;
color:var(--fg);border:0;padding:0}
.lt-quote cite{display:block;font-family:var(--sans);font-style:normal;font-size:12px;line-height:18px;
color:var(--fg3);margin-top:10px}
.lt-notes{list-style:none;padding:14px 20px;margin-top:28px;border-radius:12px;background:var(--float);
box-shadow:inset 0 0 0 1px var(--line)}
.lt-notes li{display:flex;gap:14px;padding:7px 0;line-height:26px}
.lt-notes li+li{border-top:1px solid var(--line)}
.lt-notes li>b{flex:none;min-width:3.2em;font-family:var(--wenkai);font-weight:400;color:var(--accent)}
.lt-facts{display:flex;gap:36px;justify-content:center;margin-top:32px}
.lt-facts>div{text-align:center}
.lt-facts b{display:block;font-family:var(--wenkai);font-weight:400;font-size:36px;line-height:44px;color:var(--fg)}
.lt-facts span{font-size:13px;line-height:20px;color:var(--fg2)}
.lt-credit{display:block;font-family:var(--sans);font-size:11px;line-height:16px;color:var(--fg3);margin-top:2px}
.lt-sign{display:flex;align-items:center;gap:10px;margin-top:40px;font-family:var(--wenkai);font-size:26px;
line-height:34px}
.lt-sign svg{width:24px;height:24px;flex:none}
.plasticine-mark-blob{fill:var(--accent)} .plasticine-mark-swirl{stroke:var(--bubble)}
@media (max-width:760px){
.lt{padding:20px 24px 40px}
.lt-title{font-size:36px;line-height:46px}
.lt-body>p.lt-lead,.lt-lead{font-size:17px;line-height:30px;margin-top:24px}
.lt-fig{margin:24px -8px 4px}
.lt-fig img,.lt-fig svg{height:190px}
.lt-fig figcaption{font-size:15px;line-height:22px}
.lt-quote{font-size:20px;line-height:32px;margin:28px 8px 4px}
.lt-facts{gap:24px}.lt-facts b{font-size:30px;line-height:38px}
.lt-body>p{margin-top:18px}
.lt-body{line-height:29px}
}
`;
