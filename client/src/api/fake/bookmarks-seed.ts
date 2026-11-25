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
