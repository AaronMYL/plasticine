// 假接口的书签演示数据（第 8 批第 1 条，11-09 设计稿 Bookmarks：网页栏「书签」一节的七个网站）。X 和 GitHub 的网址和
// 演示标签里的置顶一样（行尾出「已开着」的小点）。再放一条 Plasticine 自己的页面书签：网页栏只列网页书签，它不出。
// 网站都是常见网站，标题是示例，不含用户自己的资料。

import type { FakeBookmarks } from './fake-bookmarks.ts';

export function seedBookmarks(bookmarks: FakeBookmarks): void {
  bookmarks.seed({ kind: 'web', title: 'AI Fluency: Framework & Foundations',
    target: 'https://anthropic.skilljar.com/ai-fluency-framework-foundations',
    snapshot: '一门讲怎样和 AI 一起做事的课：委托、描述、辨别、负责四个方面。' });
  bookmarks.seed({ kind: 'web', title: 'X', target: 'https://x.com/home' });
  bookmarks.seed({ kind: 'web', title: '小红书', target: 'https://www.xiaohongshu.com/explore' });
  bookmarks.seed({ kind: 'web', title: '抖音精选', target: 'https://www.douyin.com/jingxuan' });
  bookmarks.seed({ kind: 'web', title: 'GitHub', target: 'https://github.com/example/plasticine' });
  bookmarks.seed({ kind: 'web', title: 'Google', target: 'https://www.google.com/' });
  bookmarks.seed({ kind: 'web', title: '服务器 - 轻量云', target: 'https://console.cloud.tencent.com/lighthouse' });
  bookmarks.seed({ kind: 'page', title: '这周要想清楚的事', target: '#/notes/seed_note_1' });
}
