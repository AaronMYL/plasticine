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

/** 报告的版式和现成的类（第 13 批新版式，照 Aaron 给的参考）。 */
export const REPORT_GUIDE = `报告（genre "report"）：按内容自由排版，用得上什么就用什么。报告不是文字堆砌：先定这一页要让他
一眼看到什么（结论、数、对比、先后），每一节按内容的形状选块，段落只用来把块连起来；长报告只有段落会被退回重排。结构：
<p class="rp-kick"><b>出处 · 第 N 期</b><span>资料截至 11 月 8 日</span><span>标签</span><span class="end">约 8 分钟读完</span></p>
<header class="rp-hero"><div><h1 class="rp-h1">一句结论当大标题，<em>最要紧的几个字</em></h1>
  <p class="rp-deck">一两句导语：这份看了什么、要回答什么。</p></div>
  <aside class="rp-brief"><p class="lb">核心判断</p><p>一段判断</p></aside>（可选，深色一块）</header>
<div class="rp-stats">（数字条，2–4 个）<div class="rp-stat"><div class="v"><b>2.41</b><i>%</i></div>
  <div class="l">说明</div></div>…</div>
<section class="rp-sec" id="英文短词" data-toc="目录里的短名">
  <div class="rp-sh"><span class="no">01 / 短名</span><h2>这一节的结论</h2><p>一句说明（可选）</p></div> …
</section>
有 3 节以上带 id 的 section，顶上自动配一条目录（data-toc 是目录里的名字，不写就用 h2），不用自己写目录。
研究类常用的块：
- 一个大数配几个小数：<div class="rp-pulse"><article class="rp-big"><b>2.41%</b><div><h3>这个数是什么</h3><p>怎么算的
  </p><a class="rp-src" href="https://…">出处 · 日期</a></div></article><div class="rp-rail"><div class="rp-stat">…</div>
  …</div></div>
- 要点格（3–5 格）：<div class="rp-points"><article><span class="n">01</span><h3>一句</h3><p>说明</p></article>…</div>
- 图配旁注：<div class="rp-duo"><figure class="ch">…</figure><aside class="rp-note"><h3>怎么读</h3><ul><li><b>要点</b>
  说明</li></ul></aside></div>
- 能筛选的案例：<div class="filt"><button class="on" data-filter="*">全部<span class="c">10</span></button>
  <button data-filter="AI">AI<span class="c">2</span></button></div>，同一节里的卡写 data-tags="AI"；卡片
  <div class="rp-cases"><article class="rp-case" data-tags="AI"><span class="n">01</span><div><h3>名字</h3>
  <p class="who">几个人 · 做什么</p><div class="tags"><span class="stt">标签</span></div><p class="hl">$105K / 月</p>
  <p class="tx">经过</p><p class="take"><b>借鉴：</b>…</p><span class="cav">口径或时间</span><a class="rp-src" href="…">
  出处</a></div></article>…</div>
- 几条方向（编号自动）：<div class="rp-steps"><article><div><h3>方向</h3><p class="fit">契合：…</p></div>
  <div class="two"><div><h4>机会与切口</h4><p>…</p></div><div class="risk"><h4>主要风险</h4><p>…</p></div></div>
  </article>…</div>
- 两两对照：<div class="rp-grid2"><article><span class="tg">标签</span><h3>…</h3><p>…</p></article>…</div>
- 还没查清的：<div class="rp-open"><article><h3>缺口</h3><p>为什么还不能下结论</p></article>…</div>
核查类（核对一段说法、一篇文章）常用的块：
- 判定一览（放在 rp-hero 后面，代替数字条）：<div class="rp-verdict"><div><b>0</b><span>完全错误</span></div>…</div>
- 先改正的说法：<div class="rp-fix"><div><s>原来的说法</s><span>该怎么说</span></div>…</div>
- 逐条判定：<div class="rp-facts"><article class="rp-fact"><div class="top"><h3>1. 原说法</h3>
  <span class="rp-badge ok">属实</span></div><p>依据</p><div class="rp-srcs"><a href="https://…">出处</a></div></article>
  …</div>（rp-badge 加 part 是部分属实、no 是不对）
- 算一笔：<div class="rp-num"><div><small>口径</small>算式</div><b>结果</b></div>
- 时间线：<div class="rp-time"><div><time>2025 年 5 月</time><h3>发生了什么</h3><p>…</p></div>…</div>
- 拆开判断：<div class="rp-dec"><article><h3>一件事</h3><p>怎么看</p></article>…</div>；给他的提醒：
  <div class="rp-call"><h3>一句</h3><p>…</p></div>
两类都能用的：
- 结论卡：<div class="cards2"><article class="rcard"><div class="tags"><span class="stt">标签</span></div>
  <h3>一句话</h3><p class="tx">说明</p><dl class="vd"><dt>要点</dt><dd>…</dd></dl></article>…</div>（cards3 是三列）
- 图表：<figure class="ch"><figcaption class="ch-h"><b>图名</b><span class="meta">单位</span>
  <span class="ch-legend"><span><i class="lg-sq"></i>系列</span><span><i class="lg-sq" style="--h:var(--accent)"></i>
  对照</span></span></figcaption> 图 <p class="ch-src">来源 [1]</p></figure>。横条现成：<div class="brow">
  <span class="bl">类别</span><span class="track"><i class="gl" style="left:50%"></i><i class="b" style="width:83%"></i>
  <i class="b2" style="width:12%"></i></span><span class="bv">83%<i>12%</i></span></div>（b2 是第二个系列，没有就不写；
  b lo 是浅色对照），刻度 <div class="ax"><span></span><span class="tk"><span style="left:0">0</span>…</span><span></span>
  </div>。别的图（折线、散点、时间段）用内联 <svg viewBox="…">，线和点用 var(--hue-sky) 等，字用 <text>；数一个都不能编。
- 状态小签：<span class="stt"><span class="sq" style="--h:var(--hue-sky)"></span>已同行评审</span>；sq 加 pre 是斜纹
  （未评审 / 预印本），加 watch 是空心（待追踪）。
- 流程：<div class="chain"><span>A</span><i class="i-arrow"></i><span>B</span></div>
- 对照表：<table class="rt"><thead><tr><th>…</th></tr></thead><tbody><tr><td>…</td><td class="f2">…</td></tr>
  </tbody></table>
- 带箭头的条目：<div class="lst"><div><i class="i-arrow"></i><span><b>要点</b> 说明</span></div></div>
  （圆点用 <i class="bu"></i>）
- 覆盖范围：<div class="cov"><div><i class="i-ok"></i>PubMed<span class="r">说明</span></div>
  <div><i class="i-alert"></i>读不到的<span class="r">原因</span></div></div>
- Plasticine 自己的判断：<div class="byai"><p>✦ …</p></div>；次要的一段 <p class="sub">。
- 来源索引（最后一节）：<div class="srcs"><a href="https://…"><span class="n">1</span><span>说明</span>
  <span class="d">网站或类别</span></a>…</div>；正文里用 [1] 指它。最后一节末尾可以写口径和时效：
  <div class="rp-foot"><p><b>口径：</b>…</p><p>…</p></div>
- 值得他点了就开始做的事，那一条加 data-follow（会进「任务 · 建议」）。`;

/** 来信的信纸和正文怎么写。 */
export const LETTER_GUIDE = `来信（genre "letter"）：信纸是固定的，日期、题目（就是 title，用霞鹜文楷，短一点像信的题目）、
署名（你的名字）都由信纸套上；你只写正文，不写 h1、不写署名：
<p class="lt-lead">第一段：直接落到他的事（他的目标、书单、正在推进的事、他说过的话），一两句说清这封信为什么写给他。</p>
<figure class="lt-fig" data-illustrate="插图的画面：具体的场景、物件、光线和色调，不要文字"><figcaption>图注一句</figcaption>
</figure>
<p>正文段落，<mark>最要紧的那几个字</mark>像荧光笔划过（一封信一两处）。</p> …
<p>最后一段留一个下一步（谁、什么时候、做什么）。</p>
插图：写一个 figure.lt-fig 带 data-illustrate，会照画面描述画一张。画面画这封信说的那件事：具体的场景、人在做什么、
关键的物件和光线（例：「夜里书桌前接电话的人，台灯亮着，窗外城市灯火」），不画泛泛的氛围；画里不要字。出不了图那一格
会自己去掉：不要自己画线稿或别的图垫着，图注也不写「生成」「原创」「线稿」这类字。
让信里有他自己的东西（每封挑一两样，不要全用）：
<blockquote class="lt-quote">他这几天说过的一句原话<cite><a data-link="message:line:…">11 月 9 日 · 你在主线里说的</a></cite>
</blockquote>（材料里有这句的出处就照抄进 data-link，点了跳到那一句；没有出处就只写日子和在哪说的，不加链接，也不另写
「这段原话」之类的链接）
<ul class="lt-notes"><li><b>周一</b><span>这封信里提到的一件具体的事</span></li>…</ul>（2–4 条，前面是日子、人名或一个词）
<div class="lt-facts"><div><b>3</b><span>篇读完</span></div><div><b>2</b><span>件等你定</span></div></div>（2–3 个真实的数）
整封信像写给一个人的信：不用小标题、不用表格和图表，除了上面这几样不堆列表。若下一步是你能替他开始做的，那一段加 data-follow。`;
