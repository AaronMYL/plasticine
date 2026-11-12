// 欢迎卡里的「开始」按这台电脑装了什么排（2026-11-12《首次使用解耦》，Aaron 选「这批一起做」）：桌面客户端认出
// 几个笔记应用（只看装没装，desktop/src/app/host-profile.ts），就把「导入我的笔记」换成具体的「导入 xx 笔记」，最多两个；
// 认不出（网页、手机、没装）照旧是服务端给的那几个。prompt 写成他会说的那句话，点了当他说的发进主线。

import type { OnboardingApp, WelcomeStart } from '../../api/shared.ts';

const GENERIC_IMPORT = 'import-notes';
const MAX_APP_STARTS = 2;

const APP_STARTS: Readonly<Record<OnboardingApp, WelcomeStart>> = {
  obsidian: { id: 'import-obsidian', label: '导入 Obsidian 笔记', icon: 'notes',
    prompt: '我用 Obsidian 记笔记，想把库导进来，你看看怎么导最方便。' },
  notion: { id: 'import-notion', label: '导入 Notion 页面', icon: 'notes',
    prompt: '我的笔记在 Notion 里，想导进来，你看看怎么导最方便。' },
  bear: { id: 'import-bear', label: '导入 Bear 笔记', icon: 'notes',
    prompt: '我用 Bear 记笔记，想导进来，你看看怎么导最方便。' },
  evernote: { id: 'import-evernote', label: '导入印象笔记', icon: 'notes',
    prompt: '我的笔记在印象笔记里，想导进来，你看看怎么导最方便。' },
  logseq: { id: 'import-logseq', label: '导入 Logseq 笔记', icon: 'notes',
    prompt: '我用 Logseq 记笔记，想导进来，你看看怎么导最方便。' },
  'apple-notes': { id: 'import-apple-notes', label: '导入 Apple 备忘录', icon: 'notes',
    prompt: '我的笔记在 Apple 备忘录里，想导进来，你看看怎么导最方便。' },
};

export function arrangeStarts(server: readonly WelcomeStart[], apps: readonly OnboardingApp[]): WelcomeStart[] {
  const fromApps = apps.map((app) => APP_STARTS[app]).slice(0, MAX_APP_STARTS);
  if (fromApps.length === 0) return [...server];
  return [...fromApps, ...server.filter((start) => start.id !== GENERIC_IMPORT)];
}
