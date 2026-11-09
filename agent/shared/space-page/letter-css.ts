// 来信的信纸（设计稿 Letter / Phone-Letter，11-09 他确认）：纸色 --bubble；正文 Geist + 系统中文；题目、图注、署名用
// 霞鹜文楷（按需加载）；题目墨色，只有署名前的 Plasticine 标记带陶土色；一张插图。信纸是固定的：日期、题目、署名由
// 显示的一端套上，模型只写正文（第一段 lt-lead、插图 lt-fig、其余段落）。

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
.lt-body>p{margin-top:18px}
.lt-body{line-height:29px}
}
`;
