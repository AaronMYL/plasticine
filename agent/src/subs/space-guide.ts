// 教模型写空间网页的说明（第 8 批第 6 条，11-09 他定）：报告按内容自由排版，用现成的类（版式底子在
// agent/shared/space-page/），不自己造；来信用固定信纸，只写正文。研究周报、个人回顾、space_write 的工具说明、
// 旧空间重写都引这里同一份。类名改了这里一起改（tests/subs/space-guide.test.ts 核对每个类都在底子里）。

/** 报告和来信都要守的规矩。 */
export const SPACE_RULES = [
  'html 只写 body 里的片段：不写 <html>/<head>/<body>、不写 <meta>/<link>/<iframe>/<form>、不用外链脚本和外链图片',
  '（显示在沙盒里，连不了网）。字体、颜色、深浅色由底子管：颜色只用 var(--fg) var(--fg2) var(--fg3) var(--line) ',
  'var(--line2) var(--tint2) var(--float) 和类别色 var(--hue-sky|ochre|teal|clay|rose|olive|slate|sage)，不写死颜色。',
  '图表只用存下来的数据画（原文里的数、你整理过的数写清依据），每张图下面写来源；图片写来源；不编数据。',
  '能点回去的写链接：原文 <a href="https://…">；Plasticine 里的东西写 <a data-link="类别:id">，类别是 message',
  '（原对话，id 是 line:<线>:<序号>）、project、memory_doc、note、space、feed_item。',
  '少量交互可以写内联 <script>（只在这一页里跑）；筛选用现成的分段控件，不用自己写。',
].join('');

/** 报告的版式和现成的类。 */
export const REPORT_GUIDE = `报告（genre "report"）：按内容自由排版，用得上什么就用什么。报告不是文字堆砌：先定这一页要让他
一眼看到什么（结论、数、对比、先后），每一节按内容的形状选块，段落只用来把块连起来；长报告只有段落会被退回重排。结构：
<header class="rp-hero">
  <p class="rp-kick"><b>出处 · 第 N 期</b><span>2026.11.02—11.08</span><span>标签</span></p>
  <h1 class="rp-h1">一句结论当大标题。</h1>
  <div class="rp-stats">（数字条，2–4 个）<div class="rp-stat"><div class="v"><b>2</b><i>篇</i></div>
    <div class="l"><span class="sq" style="--h:var(--hue-sky)"></span>说明</div></div>…</div>
</header>
<section class="rp-sec" id="英文短词" data-toc="目录里的短名">
  <div class="rp-sh"><span class="no">01</span><h2>小节标题</h2></div> …正文 <p>…
</section>
有 3 节以上带 id 的 section，右侧目录自动生成（data-toc 是目录里的名字，不写就用 h2）。现成的块：
- 结论卡：<div class="cards2"><article class="rcard"><div class="tags"><span class="stt">标签</span></div>
  <h3>一句话</h3><p class="tx">说明</p><dl class="vd"><dt>要点</dt><dd>…</dd></dl></article>…</div>（cards3 是三列）
- 状态小签：<span class="stt"><span class="sq" style="--h:var(--hue-sky)"></span>已同行评审</span>；sq 加 pre 是斜纹
  （未评审 / 预印本），加 watch 是空心（待追踪）。
- 能筛选的卡片：<div class="filt"><div class="seg"><button class="on" data-filter="*">全部<span class="c">4</span>
  </button><button data-filter="深读">深读<span class="c">2</span></button></div></div>，同一节里的卡片写
  data-tags="深读"；卡片 <article class="paper" data-tags="…"><div class="tags">…</div><h4>标题</h4>
  <p class="en">原题</p><p class="meta">作者 · 期刊 · 日期</p><p class="nx"><b>下一步要核</b> …</p></article>
  （paper dim 是虚线框，给次要的）。
- 出处一行：<div class="rp-meta"><span class="stt">…</span><span>期刊 · 日期 · 作者</span><a href="…">原文</a></div>
- 关键数字：<div class="facts"><div><b>13</b><span>名患者</span></div>…</div>
- 图表：<figure class="ch"><figcaption class="ch-h"><b>图名</b><span class="meta">单位</span>
  <span class="ch-legend"><span><i class="lg-dot"></i>系列</span></span></figcaption> 图 <p class="ch-src">来源 [1]</p>
  </figure>。横条现成：<div class="brow"><span class="bl">类别</span><span class="track"><i class="gl" style="left:50%">
  </i><i class="b" style="width:83%"></i><i class="wh" style="left:68%;width:30%"></i></span><span class="bv">83%
  <i>±15</i></span></div>（b lo 是浅色对照），刻度 <div class="ax"><span></span><span class="tk"><span style="left:0">0</span>
  …</span><span></span></div>。别的图（折线、散点、时间线）用内联 <svg viewBox="…">，线和点用 var(--hue-sky) 等，
  字用 <text>；数一个都不能编。
- 流程：<div class="chain"><span>A</span><i class="i-arrow"></i><span>B</span></div>
- 对照表：<table class="rt"><thead><tr><th>…</th></tr></thead><tbody><tr><td>…</td><td class="f2">…</td></tr>
  </tbody></table>
- 带箭头的条目：<div class="lst"><div><i class="i-arrow"></i><span><b>要点</b> 说明</span></div></div>
  （圆点用 <i class="bu"></i>）
- 覆盖范围：<div class="cov"><div><i class="i-ok"></i>PubMed<span class="r">说明</span></div>
  <div><i class="i-alert"></i>读不到的<span class="r">原因</span></div></div>
- Plasticine 自己的判断：<div class="byai"><p>✦ …</p></div>；次要的一段 <p class="sub">。
- 来源索引（最后一节）：<div class="srcs"><a href="https://…"><span class="n">1</span><span>说明</span>
  <span class="d">域名</span></a>…</div>；正文里用 [1] 指它。
- 值得他点了就开始做的事，那一条加 data-follow（会进「任务 · 建议」）。`;

/** 来信的信纸和正文怎么写。 */
export const LETTER_GUIDE = `来信（genre "letter"）：信纸是固定的，日期、题目（就是 title，用霞鹜文楷，短一点像信的题目）、
署名「Plasticine」都由信纸套上；你只写正文，不写 h1、不写署名：
<p class="lt-lead">第一段：直接落到他的事（他的目标、书单、正在推进的事、他说过的话），一两句说清这封信为什么写给他。</p>
<figure class="lt-fig" data-illustrate="插图的画面：具体的场景、物件、光线和色调，不要文字"><figcaption>图注一句</figcaption>
</figure>
<p>正文段落，<b>最要紧的一句加粗</b>。</p> …
<p>最后一段留一个下一步（谁、什么时候、做什么）。</p>
插图：写一个 figure.lt-fig 带 data-illustrate，Plasticine 会照画面描述生成一张，标「Plasticine 生成」。不确定能不能出图时，
在同一个 figure 里自己画一张内联线稿垫着：<svg class="lt-draw" viewBox="0 0 600 300">…</svg>，只用线条和几块淡色
（stroke="var(--fg3)"、fill="var(--tint2)"、点睛处 var(--accent)），画和这封信有关的一个具体物件或场景，不写字。
让信里有他自己的东西（每封挑一两样，不要全用）：
<blockquote class="lt-quote">他这几天说过的一句原话<cite>11 月 9 日 · 在主线里</cite></blockquote>
<ul class="lt-notes"><li><b>周一</b><span>这封信里提到的一件具体的事</span></li>…</ul>（2–4 条，前面是日子、人名或一个词）
<div class="lt-facts"><div><b>3</b><span>篇读完</span></div><div><b>2</b><span>件等你定</span></div></div>（2–3 个真实的数）
整封信像写给一个人的信：不用小标题、不用表格和图表，除了上面这几样不堆列表。若下一步是你能替他开始做的，那一段加 data-follow。`;
