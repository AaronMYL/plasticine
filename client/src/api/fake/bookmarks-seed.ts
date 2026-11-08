// 假接口的书签演示数据（第 110 条，设计稿 2026-11-03 的 NewTab / Bookmarks 两张画板）：三个项目各几条、两组保存的
// 分组、一条没归项目的（Plasticine 推一个项目）。网站和标题都是示例，不含用户自己的资料。

import type { FakeBookmarks } from './fake-bookmarks.ts';
import { DESIGN_PROJECTS } from './design-projects.ts';

const HUNTER = DESIGN_PROJECTS.hunter.id;
const PLASTICINE = DESIGN_PROJECTS.plasticine.id;
const PERSONAL = DESIGN_PROJECTS.personal.id;

export function seedBookmarks(bookmarks: FakeBookmarks): void {
  bookmarks.seed({ kind: 'web', title: 'Show HN：发帖前读这页', target: 'https://news.ycombinator.com/showhn.html',
    projectId: HUNTER, snapshot: 'Show HN 是给你做出来、别人能试的东西。先放一个能试的链接，别放等候名单。' });
  bookmarks.seed({ kind: 'web', title: 'cyber-hunter · Issues',
    target: 'https://github.com/example/cyber-hunter/issues',
    projectId: HUNTER, snapshot: '两个人在问怎么接单。' });
  bookmarks.seed({ kind: 'web', title: '上架清单', target: 'https://www.producthunt.com/launch', projectId: HUNTER });
  bookmarks.seed({ kind: 'group', title: '冷启动渠道', projectId: HUNTER, tabs: [
    { kind: 'web', title: 'Show HN', target: 'https://news.ycombinator.com/show' },
    { kind: 'web', title: 'Product Hunt', target: 'https://www.producthunt.com/' },
    { kind: 'web', title: 'Indie Hackers', target: 'https://www.indiehackers.com/' },
  ] });
  bookmarks.seed({ kind: 'web', title: 'X', target: 'https://x.com/home', projectId: HUNTER });
  bookmarks.seed({ kind: 'web', title: 'What a personal agent should remember',
    target: 'https://field-notes.dev/agents/what-to-remember', projectId: PLASTICINE,
    snapshot: 'A useful memory looks less like a recording and more like a notebook someone keeps for you.' });
  bookmarks.seed({ kind: 'web', title: 'WKWebView · 注入用户脚本',
    target: 'https://developer.apple.com/documentation/webkit/wkwebview', projectId: PLASTICINE });
  bookmarks.seed({ kind: 'page', title: '这周要想清楚的事', target: '#/notes/seed_note_1', projectId: PLASTICINE });
  bookmarks.seed({ kind: 'group', title: '浏览器调研', projectId: PLASTICINE, tabs: [
    { kind: 'web', title: 'Arc', target: 'https://arc.net/' },
    { kind: 'web', title: 'Chrome 标签分组',
      target: 'https://blog.google/products/chrome/manage-tabs-with-google-chrome/' },
    { kind: 'web', title: 'Safari 标签组', target: 'https://support.apple.com/guide/safari/use-tab-groups-ibrw1033/mac' },
    { kind: 'web', title: 'Immersive Translate', target: 'https://immersivetranslate.com/' },
    { kind: 'web', title: 'WebKit', target: 'https://webkit.org/' },
  ] });
  bookmarks.seed({ kind: 'web', title: '备忘录导出说明', target: 'https://support.apple.com/guide/notes/welcome/mac',
    projectId: PERSONAL });
  bookmarks.seed({ kind: 'web', title: '天气预报', target: 'https://www.weather.com.cn/', projectId: PERSONAL });
  bookmarks.seed({ kind: 'web', title: 'Agents that ask before they act', target: 'https://arxiv.org/abs/2510.01234',
    snapshot: '像 Plasticine 这样的个人 agent，在不可逆的动作前先问一句，比事后道歉便宜得多。' });
}
