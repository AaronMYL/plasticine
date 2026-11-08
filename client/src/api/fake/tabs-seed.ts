// 假接口模式下的演示竖排标签（11-07 设计稿 Web）：八个置顶、「Cyber Hunter」一组三页（展开）、「研究」一组五页（收起）、
// 今天开的五页。网站都是示例。11-08 起摆放存在本体里：这一份是假服务端一开始就有的那一份。
// 演示的网站图标（fake-web-tabs.ts 的 faviconSrc）：几个常见网站给一张示意图标，example.* 这些没有，画首字母。

import type { WebTab, WebTabGroup, WebTabsLayout } from '../shared.ts';

const PINS: readonly [string, string][] = [
  ['https://mail.example.com/', '邮箱'], ['https://github.com/example/plasticine', 'GitHub'],
  ['https://x.com/home', 'X'], ['https://www.douyin.com/', '抖音'], ['https://notion.example.com/', 'Notion'],
  ['https://reddit.com/', 'Reddit'], ['https://figma.example.com/', 'Figma'], ['https://claude.ai/', 'Claude'],
];

const HUNTER: readonly [string, string][] = [
  ['https://github.com/example/plasticine/issues', 'plasticine · Issues'],
  ['https://cyberhunter.top/download', 'cyberhunter.top/download'],
  ['https://console.dnspod.cn/', 'DNSPod 解析'],
];

const RESEARCH: readonly [string, string][] = [
  ['https://pubmed.example.org/memory-replay', '睡眠中的记忆重放 · PubMed'],
  ['https://nature.example.com/hippocampus', 'Hippocampal replay in humans'],
  ['https://elife.example.org/prediction', '预测加工综述'],
  ['https://scholar.example.com/consolidation', '记忆巩固 · 学术搜索'],
  ['https://neuro.example.org/attention', '注意力的神经机制'],
];

const TODAY: readonly [string, string][] = [
  ['https://www.google.com/search?q=electron+vertical+tabs', 'electron vertical tabs - Google 搜索'],
  ['https://www.youtube.com/watch?v=electron-memory', '一条讲 Electron 内存的视频'],
  ['https://mdec.example.my/de-rantau', 'MDEC · DE Rantau'],
  ['https://www.biorxiv.org/collection/neuroscience', 'bioRxiv · Neuroscience'],
  ['https://blog.example.com/vertical-tabs', 'Arc 的竖排标签是怎么来的'],
];

/** 演示里一开始在看的那一页（今天的第一页）。 */
export const DEMO_CURRENT_TAB = 'demo-today-0';

export function demoWebTabsLayout(now: Date): WebTabsLayout {
  const at = now.toISOString();
  const tabs: WebTab[] = [];
  const make = (list: readonly [string, string][], prefix: string): string[] => list.map(([url, title], index) => {
    const id = `demo-${prefix}-${index}`;
    tabs.push({ id, kind: 'web', url, title, openedBy: 'user', openedAt: at, visitedAt: at });
    return id;
  });
  const pinned = make(PINS, 'pin');
  const groups: WebTabGroup[] = [
    { id: 'demo-group-hunter', name: 'Cyber Hunter', hue: 'sky', collapsed: false, tabIds: make(HUNTER, 'hunter') },
    { id: 'demo-group-research', name: '研究', hue: 'teal', collapsed: true, tabIds: make(RESEARCH, 'research') },
  ];
  const today = make(TODAY, 'today');
  return { tabs, pinned, groups, today, archived: [] };
}

function svg(body: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`)}`;
}

/** 演示用的网站图标（示意，不是各家真的图标）：有的有底色，有的是透明底（深色模式下要看得见）。 */
const DEMO_ICONS: Readonly<Record<string, string>> = {
  'github.com': svg('<circle cx="16" cy="16" r="14" fill="#1f2328"/><path d="M11 23c0-3 1-4 2-4.5-3-.5-5-2-5-5.5'
    + ' 0-1.5.5-2.5 1.2-3.3-.2-.5-.4-1.8.2-3.2 1.2 0 2.4.8 3.2 1.4a11 11 0 0 1 6.8 0c.8-.6 2-1.4 3.2-1.4.6 1.4.4 2.7.2'
    + ' 3.2.8.8 1.2 1.8 1.2 3.3 0 3.5-2 5-5 5.5 1 .6 2 1.7 2 4.5" fill="#fff"/>'),
  'x.com': svg('<path d="M5 5h6.5l5 7 6-7H25l-7.3 8.5L27 27h-6.5l-5.5-7.6L8.5 27H6l8-9.2z" fill="#0f1419"/>'),
  'douyin.com': svg('<rect width="32" height="32" rx="7" fill="#111"/><path d="M18 7h3.5c.3 2.4 1.8 4 4.5 4.3v3.5'
    + 'c-1.7 0-3.2-.5-4.5-1.4V20a6 6 0 1 1-6-6v3.6a2.5 2.5 0 1 0 2.5 2.4z" fill="#fff"/>'),
  'reddit.com': svg('<circle cx="16" cy="16" r="15" fill="#ff4500"/><ellipse cx="16" cy="18.5" rx="8" ry="5.5"'
    + ' fill="#fff"/><circle cx="13" cy="18" r="1.3" fill="#ff4500"/><circle cx="19" cy="18" r="1.3" fill="#ff4500"/>'),
  'claude.ai': svg('<rect width="32" height="32" rx="7" fill="#d97757"/><path d="M16 6l2 7.5L25 11l-5.5 5L25 21l-7'
    + '-2.5L16 26l-2-7.5L7 21l5.5-5L7 11l7 2.5z" fill="#fff"/>'),
  'google.com': svg('<path d="M28 16.3c0-1-.1-1.9-.3-2.8H16v5.3h6.7a5.7 5.7 0 0 1-2.5 3.8v3.1h4C26.6 23.6 28 20.3'
    + ' 28 16.3z" fill="#4285f4"/><path d="M16 28c3.4 0 6.2-1.1 8.2-3l-4-3.1c-1.1.8-2.5 1.2-4.2 1.2-3.2 0-6-2.2-7-5.2'
    + 'H4.9v3.2A12 12 0 0 0 16 28z" fill="#34a853"/><path d="M9 17.9a7.2 7.2 0 0 1 0-4.6V10H4.9a12 12 0 0 0 0 10.9z"'
    + ' fill="#fbbc05"/><path d="M16 8.8c1.8 0 3.4.6 4.7 1.9l3.5-3.5A12 12 0 0 0 4.9 10.1L9 13.3c1-3 3.8-4.5 7-4.5z"'
    + ' fill="#ea4335"/>'),
  'youtube.com': svg('<rect x="2" y="7" width="28" height="18" rx="5" fill="#ff0000"/><path d="M13 11.5v9l8-4.5z"'
    + ' fill="#fff"/>'),
  'biorxiv.org': svg('<rect width="32" height="32" rx="6" fill="#bd2736"/><text x="16" y="21" font-size="12"'
    + ' font-family="Georgia" font-weight="700" fill="#fff" text-anchor="middle">bio</text>'),
  'cyberhunter.top': svg('<rect width="32" height="32" rx="8" fill="#2b2826"/><circle cx="16" cy="16" r="7"'
    + ' fill="none" stroke="#a1674e" stroke-width="3"/><circle cx="16" cy="16" r="2" fill="#a1674e"/>'),
};

/** 演示的网站图标：几个常见网站有，example.* 和别的没有（null，画首字母）。 */
export function demoFavicon(host: string): string | null {
  return DEMO_ICONS[host] ?? null;
}
