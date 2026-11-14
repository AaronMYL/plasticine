// 设置里的查找（11-12 设置页优化）：六段里有二十来块，记不住哪块在哪一段。左边顶上一个查找框，打几个字列出对得上的块，
// 点了去那一段并滚到那一块。这里是各块的名字（和界面上段头的字一样，滚过去靠它对）和几个常用的叫法；加了新块记得补一条
// （tests/views/settings/settings-search.test.tsx 核对每条的段头真的在那一段里）。

import type { SettingsSection } from '../../shell/routes.ts';

export interface SettingsEntry {
  section: SettingsSection;
  /** 界面上那一块段头的字。 */
  title: string;
  /** 别的叫法（空格隔开）：他可能会打的词。 */
  words: string;
  /** 只在桌面客户端里才有的块（网页、手机上那一段里没有它，点了只到那一段）。 */
  desktopOnly?: true;
}

export const SETTINGS_INDEX: readonly SettingsEntry[] = [
  { section: 'general', title: '外观', words: '主题 颜色 深色 浅色 暗色 夜间 暖纸 石墨 松林 午夜 跟随系统' },
  { section: 'general', title: '时区', words: '时间 日期' },
  { section: 'general', title: '通知', words: '推送 提醒 系统通知 测试通知 新消息' },
  { section: 'ai', title: '模型', words: '提供商 连接 ChatGPT Claude DeepSeek API key 订阅 默认模型' },
  { section: 'ai', title: '各用哪个', words: '主线 后台线 心跳 做梦 翻译 思考 用途 模型' },
  { section: 'ai', title: '同时做几件事', words: '并发 后台 任务 排队 上限 自动' },
  { section: 'ai', title: '技能', words: 'skill 做法 方法' },
  { section: 'ai', title: '工具开关', words: '工具 权限 关掉 命令' },
  { section: 'browser', title: '搜索引擎', words: '必应 谷歌 百度 DuckDuckGo 搜索 地址栏' },
  { section: 'browser', title: '登录着的网站', words: '登录 cookie 网站 退出 账号', desktopOnly: true },
  { section: 'browser', title: '导入', words: 'Chrome Safari 搬 登录 导入', desktopOnly: true },
  { section: 'browser', title: '网页翻译', words: '翻译 双语 译文 用词表 语言' },
  { section: 'account', title: '在别的设备上用', words: '手机 网址 二维码 域名 远程 访问' },
  { section: 'account', title: '登录着的设备', words: '设备 退出 登出 直连 中继' },
  { section: 'grants', title: '对外可见', words: '隐私 朋友 合作 公开 私密 档位 放开 谁能问到' },
  { section: 'grants', title: '对外授权', words: '授权 自动发出 发邮件 发消息 许可' },
  { section: 'system', title: '运行情况', words: '版本 磁盘 运行 状态 邮件' },
  { section: 'system', title: '日历和提醒事项', words: '日历 提醒 Apple Mac' },
  { section: 'system', title: '备份', words: '恢复 还原 备份 导出' },
];

/** 标题或别的叫法里有这几个字的；不分大小写。没打字是空。 */
export function searchSettings(query: string, index: readonly SettingsEntry[] = SETTINGS_INDEX): SettingsEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') {
    return [];
  }
  const inTitle = index.filter((entry) => entry.title.toLocaleLowerCase().includes(needle));
  const inWords = index.filter((entry) => !inTitle.includes(entry) && entry.words.toLocaleLowerCase().includes(needle));
  return [...inTitle, ...inWords];
}
