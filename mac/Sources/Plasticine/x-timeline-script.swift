// 生成的文件，不要手改：改 client/src/mac/x-timeline-page.ts，再运行 node scripts/generate-x-timeline-script.ts。
// 读 X「关注」时间线的注入脚本（第 3 批信息流），由 x-timeline-reader.swift 装进看不见的网页视图的独立脚本世界。

enum XTimelineScript {
    static let source = #"""
(() => {
if (window.__plasticineXTimeline) return;
// 读 X「关注」时间线的注入脚本（第 3 批，用户 11-04 定：用他在 Plasticine 浏览器里的 X 登录，Mac 在线时定时读）。
// Mac 在一个看不见的网页视图里载入 x.com，用和网页标签同一份登录（同一个网站数据存储），在独立脚本世界里跑这一段：
// 先切到「关注」那一栏，再一边往下翻一边收帖子——作者、头像、正文、第一张图、时间、链接——交回原生层，原生层交给服务端
// （agent/shared/api/feed-x.ts 的 XPost）。只读不点别的；广告（没有时间链接的）跳过。scripts/generate-x-timeline-script.ts
// 把它去掉类型写进 mac/Sources/Plasticine/x-timeline-script.swift，所以这里不 import 运行时的东西。
//
// X 改版时最先坏的是这些选择器：读不到帖子时原生层报 layout_changed，设置里那一行写「X 改版了」。

/** 交给服务端的一条帖子（agent/shared/api/feed-x.ts 的 XPost；这里只 import 类型，生成脚本时会去掉）。 */

// 和 feed-x.ts 的 X_TEXT_MAX_CHARS、state-daily.ts 的 FEED_IMAGE_RATIO_MIN / MAX 一致（注入脚本里不能 import 常量；
// 测试按服务端的 schema 核对）。
const TEXT_MAX_CHARS = 4_000;
const RATIO_MIN = 0.2;
const RATIO_MAX = 5;
const STATUS_PATH = /^\/([A-Za-z0-9_]{1,30})\/status\/(\d{1,30})(?:\/|$)/;
const FOLLOWING_TAB_NAMES = ['Following', '正在关注', '关注', '關注中', 'フォロー中'];

function https(raw                           , base        )                {
  if (raw === null || raw === undefined || raw === '') { return null; }
  try {
    const url = new URL(raw, base);
    return url.protocol === 'https:' ? url.href : null;
  } catch (cause) {
    if (cause instanceof TypeError) { return null; }
    throw cause;
  }
}

/** 正文：表情是 <img alt>，换成 alt；换行照留。 */
function textOf(node                )         {
  if (node === null) { return ''; }
  let text = '';
  const walk = (current      )       => {
    if (current.nodeType === 3) {
      text += current.nodeValue ?? '';
    } else if (current instanceof HTMLImageElement) {
      text += current.alt;
    } else if (current instanceof HTMLBRElement) {
      text += '\n';
    } else {
      current.childNodes.forEach(walk);
    }
  };
  walk(node);
  return text.trim().slice(0, TEXT_MAX_CHARS);
}

function ratioOf(image                  )                {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) { return null; }
  const ratio = image.naturalHeight / image.naturalWidth;
  return ratio >= RATIO_MIN && ratio <= RATIO_MAX ? Math.round(ratio * 1000) / 1000 : null;
}

/** 一条帖子；广告、没有状态链接的（没有 time 的那种）、作者认不出的给 null。 */
function readPost(article         , base        )                       {
  const time = article.querySelector('time[datetime]');
  const link = time?.closest('a[href]')?.getAttribute('href') ?? null;
  const match = link === null ? null : STATUS_PATH.exec(new URL(link, base).pathname);
  if (time === null || match === null) { return null; }
  const handle = match[1] ?? '';
  const names = article.querySelector('[data-testid="User-Name"]');
  const author = names?.querySelector('a[href] span')?.textContent?.trim() || handle;
  const avatar = article.querySelector                  ('[data-testid="Tweet-User-Avatar"] img');
  const photo = article.querySelector                  ('[data-testid="tweetPhoto"] img');
  const at = Date.parse(time.getAttribute('datetime') ?? '');
  return {
    id: match[2] ?? '',
    handle,
    author: author.slice(0, 200),
    avatar: https(avatar?.getAttribute('src'), base),
    text: textOf(article.querySelector('[data-testid="tweetText"]')),
    image: https(photo?.getAttribute('src'), base),
    imageRatio: photo === null ? null : ratioOf(photo),
    publishedAt: Number.isFinite(at) ? new Date(at).toISOString() : null,
  };
}

/** 页面现在是什么样：没登录（登录页、登录按钮）、还在载入、能读了。 */
function timelineState(doc          , location        )                 {
  const path = new URL(location).pathname;
  if (path.startsWith('/login') || path.startsWith('/i/flow/login') || path === '/'
    || doc.querySelector('[data-testid="loginButton"], [data-testid="signupButton"]') !== null) {
    return 'signed_out';
  }
  return doc.querySelector('[data-testid="primaryColumn"]') === null ? 'loading' : 'ready';
}

/** 切到「关注」那一栏：已经在就不点；点了回 true（原生层等它载完再读）。找不到这一栏回 null。 */
function chooseFollowing(doc          )                 {
  const tabs = [...doc.querySelectorAll             ('[role="tablist"] [role="tab"]')];
  const tab = tabs.find((candidate) => FOLLOWING_TAB_NAMES.includes(candidate.textContent?.trim() ?? ''));
  if (tab === undefined) { return null; }
  if (tab.getAttribute('aria-selected') === 'true') { return false; }
  tab.click();
  return true;
}

/** 收一遍当前页面上的帖子，并进 seen（按帖子标识去重，翻页时同一条会出现好几次）。 */
function collectPosts(doc          , base        , seen                            )         {
  for (const article of doc.querySelectorAll('article[data-testid="tweet"]')) {
    const post = readPost(article, base);
    if (post !== null && !seen.has(post.id)) { seen.set(post.id, post); }
  }
  return seen.size;
}

/** 装到 window 上给原生层一步步调：state → following → (collect → scroll) × n → posts。 */
function installTimelineReader(win        )                  {
  const seen = new Map                       ();
  return {
    state: () => timelineState(win.document, win.location.href),
    following: () => chooseFollowing(win.document),
    collect: () => collectPosts(win.document, win.location.href, seen),
    scroll: () => win.scrollBy(0, win.innerHeight * 0.9),
    posts: () => [...seen.values()],
  };
}
window.__plasticineXTimeline = installTimelineReader(window);
})();
"""#
}
