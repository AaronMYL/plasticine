// 假接口的信息流演示数据（第 3 批设计稿《信息流 · 瀑布流》）：X 上关注的人、两个订阅、按关注点搜的新闻，有图的大卡、
// 没图的短卡、命中关注点的、收藏过的。配图和头像是本地画的 SVG（真接口里是服务端图片代理地址），只给开发和截图用。

import type { FeedItemView } from '../types.ts';
import { NEWS_SOURCE_ID, X_SOURCE_ID, type FakeFeed } from './fake-feed.ts';

const DOUYIN_SOURCE_ID = 'src_douyin';

const HOUR_MS = 60 * 60 * 1000;

/** 一张「照片」：几块平涂的色块，比例按 ratio（高 / 宽）。 */
function picture(ratio: number, colors: readonly [string, string, string]): string {
  const width = 600;
  const height = Math.round(width * ratio);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="${colors[0]}"/>`
    + `<rect x="0" y="${Math.round(height * 0.62)}" width="${width}" height="${height}" fill="${colors[1]}"/>`
    + `<circle cx="${Math.round(width * 0.72)}" cy="${Math.round(height * 0.34)}" r="${Math.round(height * 0.16)}"`
    + ` fill="${colors[2]}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** 一个头像：底色 + 一个字。 */
function avatar(letter: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56"`
    + ` fill="${color}"/><text x="28" y="36" font-size="24" text-anchor="middle" fill="#ffffff"`
    + ` font-family="sans-serif">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function seedFeedBoard(feed: FakeFeed, now: Date): void {
  const ago = (hours: number): string => new Date(now.getTime() - hours * HOUR_MS).toISOString();
  const checked = { checkedAt: ago(0.5), okAt: ago(0.5), error: null };
  feed.seedSource({ id: X_SOURCE_ID, kind: 'x', label: 'X · 你关注的人', ref: 'x:following', status: checked });
  feed.seedSource({ id: NEWS_SOURCE_ID, kind: 'internal', label: '按关注点搜新闻', ref: 'internal:news',
    status: { checkedAt: ago(1), okAt: ago(25), error: '选材未完成：模型的订阅额度用完了；这次没写入未经判断的新闻' } });
  feed.seedSource({ id: 'src_ai', kind: 'interest', label: '个人 AI', query: '个人 AI agent' });
  feed.seedSource({ id: 'src_slow', kind: 'rss', label: '慢工博客', query: 'https://blog.example.org/feed',
    status: checked });
  feed.seedSource({ id: 'src_indie', kind: 'rss', label: '独立开发周刊', query: 'https://indie.example.com/rss',
    status: checked });
  const lin = { name: '林间', handle: 'linjian_dev', avatar: avatar('林', '#587559') };
  const maya = { name: 'Maya Chen', handle: 'mayabuilds', avatar: avatar('M', '#5a6b85') };
  const hit = { concernId: 'c_personal_ai', topic: '个人 AI' };
  const items: Array<Pick<FeedItemView, 'id' | 'title'> & Partial<FeedItemView>> = [
    { id: 'fb_sync', title: '本地优先软件的同步难题', sourceId: 'src_slow', site: 'blog.example.org',
      url: 'https://blog.example.org/local-first-sync', summary: '同一份文档在两台设备上各改了一遍，联网之后该听谁的？',
      image: { src: picture(0.5, ['#e7e3da', '#cfc8b8', '#cc7d5e']), ratio: 0.5 }, arrivedAt: ago(1.2), ...hit },
    { id: 'fb_memory', title: '把记忆拆成「你说过的」和「它推出来的」两栏以后', sourceId: X_SOURCE_ID, author: lin,
      url: 'https://x.com/linjian_dev/status/1850000000000000001',
      summary: '把记忆拆成「你说过的」和「它推出来的」两栏以后，纠错次数降了一半。截图是两周的数。',
      image: { src: picture(0.62, ['#dfe4dc', '#b9c4b4', '#587559']), ratio: 0.62 }, arrivedAt: ago(1.5), ...hit },
    { id: 'fb_edge', title: '多家厂商发布端侧大模型', sourceId: 'src_ai', site: 'news.example.com',
      url: 'https://news.example.com/edge-models', summary: '新一代手机芯片能在本地跑百亿参数模型，延迟和隐私都受益。',
      why: '你关注「个人 AI」，端侧模型和你的 Mac 本地能力有关。', arrivedAt: ago(2) },
    { id: 'fb_bounty', title: 'shipped: bounty board where agents claim tasks', sourceId: X_SOURCE_ID, author: maya,
      url: 'https://x.com/mayabuilds/status/1850000000000000002',
      summary: 'shipped: bounty board where agents claim tasks and humans review. 3 days in, 41 tasks done.',
      arrivedAt: ago(2.2), saved: true },
    { id: 'fb_indie88', title: '第 88 期：一个人做产品的第一百天', sourceId: 'src_indie', site: 'indie.example.com',
      url: 'https://indie.example.com/88', summary: '本期三篇：定价、冷启动、怎么拒绝需求。',
      image: { src: picture(0.4, ['#e4e2ea', '#c9c5d4', '#5a6b85']), ratio: 0.4 }, arrivedAt: ago(20) },
    { id: 'fb_tip', title: '小技巧：让 AI 每次出卡都写清「为什么问你」', sourceId: X_SOURCE_ID, author: lin,
      url: 'https://x.com/linjian_dev/status/1850000000000000003',
      summary: '小技巧：让 AI 每次出卡都写清「为什么问你」，一周后回头看哪些卡其实不该问。', arrivedAt: ago(21) },
    { id: 'fb_browser', title: '浏览器自动化工具更新', sourceId: 'src_ai', site: 'tech.example.net',
      url: 'https://tech.example.net/browser-automation', summary: '新版支持复用本机登录状态，减少云端被风控的问题。',
      arrivedAt: ago(22) },
    { id: 'fb_offline', title: '离线一周之后', sourceId: 'src_slow', site: 'blog.example.org',
      url: 'https://blog.example.org/offline-week', summary: '合并只用了不到一秒，难的是让人看懂两边各发生了什么。',
      arrivedAt: ago(46) },
  ];
  for (const item of items) {
    feed.seedItem({ origin: 'feed', ...item });
  }
  seedTranslated(feed, ago);
}

const LONG_POST = 'We handed 4,800 backtested trading strategies to a model and let it run for three months. The '
  + 'conclusion is plain: almost all of the highest-Sharpe ones were overfit, and the ones that survived were the '
  + 'simplest rules. Here is how we filtered them: first we split the data by year, then we threw away anything '
  + 'that only worked in one regime, then we paper-traded what was left for another month.';
const LONG_ZH = '我们把 4,800 个回测过的交易策略交给一个模型跑了三个月。结论很朴素：夏普比最高的那一批几乎全是过拟合，'
  + '真正活下来的是规则最简单的那几条。下面是我们怎么筛的：先按年份切开数据，再扔掉只在一种行情里有效的，'
  + '剩下的再模拟盘跑一个月。';

/** 第 6 批第 8、9 条（设计稿 Feed）：抓取时翻好的英文帖（短的、长的）、带小图表的新闻、抖音收藏总结来的一条。 */
function seedTranslated(feed: FakeFeed, ago: (hours: number) => string): void {
  feed.seedSource({ id: DOUYIN_SOURCE_ID, kind: 'douyin', label: '抖音收藏', ref: 'douyin:favorites' });
  feed.seedSource({ id: 'src_tom', kind: 'rss', label: 'Tom 的博客', query: 'https://tom.example.com/feed' });
  const lena = { name: 'Lena Park', handle: 'lenapark', avatar: avatar('L', '#a3664f') };
  const sam = { name: 'Sam Rivera', handle: 'samr', avatar: avatar('S', '#5a6b85') };
  const items: Array<Pick<FeedItemView, 'id' | 'title'> & Partial<FeedItemView>> = [
    { id: 'fz_lena', title: 'Lena Park', sourceId: X_SOURCE_ID, author: lena,
      url: 'https://x.com/lenapark/status/1850000000000000011',
      summary: 'When fundraising, don\'t rush to give numbers. First make clear whose problem you solve; numbers prove '
        + 'it, they don\'t replace it.',
      zh: { state: 'done', lang: 'en', from: '英文', title: null, digest: null,
        text: '融资时别急着给数字。先讲清楚你在解决谁的什么问题，数字是用来证明这件事的，不是用来代替它的。' },
      arrivedAt: ago(0.3) },
    { id: 'fz_sam', title: 'Sam Rivera', sourceId: X_SOURCE_ID, author: sam,
      url: 'https://x.com/samr/status/1850000000000000012', summary: LONG_POST,
      zh: { state: 'done', lang: 'en', from: '英文', title: null, text: LONG_ZH,
        digest: '把 4,800 个回测策略交给模型跑了三个月：夏普比最高的几乎全是过拟合，活下来的是规则最简单的那几条。' },
      arrivedAt: ago(0.4) },
    { id: 'fz_ev', title: 'US EV sales rise for a third month', sourceId: NEWS_SOURCE_ID, site: 'news.example.com',
      url: 'https://news.example.com/ev-sales',
      summary: 'Monthly EV sales in the US rose for the third month in a row.',
      zh: { state: 'done', lang: 'en', from: '英文', title: '美国电动车月销量连续三个月回升',
        text: '美国电动车月销量连续第三个月回升。', digest: null },
      chart: { kind: 'line', caption: '月销量，近 12 个月', source: '行业协会月报', points: [
        { label: '12月', value: 88 }, { label: '1月', value: 86 }, { label: '2月', value: 91 },
        { label: '3月', value: 89 }, { label: '4月', value: 95 }, { label: '5月', value: 93 },
        { label: '6月', value: 99 }, { label: '7月', value: 97 }, { label: '8月', value: 104 },
        { label: '9月', value: 102 }, { label: '10月', value: 109 }, { label: '11月', value: 112 }] },
      arrivedAt: ago(0.5) },
    { id: 'fz_douyin', title: '普通人做指数定投的三个误区', sourceId: DOUYIN_SOURCE_ID,
      author: { name: '理财小课堂', handle: null, avatar: null }, url: 'https://www.douyin.com/video/7300000000000000000',
      summary: '讲定投最常见的三个误区。',
      video: { kind: 'video', durationSeconds: 222, stage: 'summarized',
        points: ['回撤时停投，等于放弃了定投的意义', '只看年化，不看最大回撤'],
        related: ['你笔记里记过「每月 3000 定投」'] },
      arrivedAt: ago(20) },
    { id: 'fz_tom', title: '用 SQLite 做全文搜索，中文怎么分词', sourceId: 'src_tom', site: 'tom.example.com',
      url: 'https://tom.example.com/sqlite-fts',
      summary: 'FTS5 默认按空格切，中文要换 trigram 或接 jieba；trigram 最省事，代价是索引大三倍。', arrivedAt: ago(0.6) },
  ];
  for (const item of items) {
    feed.seedItem({ origin: 'feed', ...item });
  }
}
