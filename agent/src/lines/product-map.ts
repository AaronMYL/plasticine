import { PRODUCT_ROUTES } from '../../shared/product-links.ts';

const MODULES = [
  ['笔记：用户写的文字', ['note_']],
  ['资料库：报告、来信、网页归档、图书笔记、文件、最近删除', ['space_', 'library_', 'subscription_']],
  ['信息流：订阅和收藏', ['video_', 'feed_']],
  ['图书：原书、标注和阅读进度', ['book_']],
  ['任务和定时：后台工作、周期任务', ['start_line', 'tell_line', 'list_lines', 'schedule_', 'task_']],
  ['消息：联系人、群组、对方的 Plasticine', ['message_', 'send_task_card', 'list_inbox', 'read_inbox']],
  ['网页：Plasticine 内置标签页', ['tab_', 'cloud_browser_']],
  ['设备：Mac、Windows 和服务器', ['device_', 'server_']],
  ['记忆：共用的记忆文档', ['remember', 'forget', 'read_memory_doc', 'search_memory', 'conversation_search']],
  ['Soul：主线的做事方式和队友自己的职责', ['soul_']],
  ['队友：长期成员、群组和交接', ['mate_']],
  ['授权：对外发出前核对账号、收件人、内容和有效范围', ['outbound_']],
] as const;

/** 每次请求从实际可用工具生成；关闭工具组后提示里也不再声称能用。 */
export function productMap(tools: readonly { name: string }[]): string {
  const names = [...new Set(tools.map((tool) => tool.name))];
  const modules = MODULES.map(([label, prefixes]) => {
    const available = names.filter((name) => prefixes.some((prefix) => name.startsWith(prefix)));
    return `- ${label}。${available.length === 0 ? '可从产品界面打开。' : `工具：${available.join('、')}。`}`;
  });
  return ['## Plasticine 的产品地图', ...modules,
    '站内入口：', ...PRODUCT_ROUTES.map((route) => `- ${route.kind}：${route.prefix}<编码后的 id>`),
    '- 资料库：#/library；最近删除：#/library/trash；定时：#/tasks/timed；记忆：#/memory。',
    '内置网页通过 device_action 的 tab_* 动作操作；系统 Chrome 和整台电脑通过设备截屏、点按、输入操作。',
    '改已有内容先读取版本，改在原处；自己写的新报告和整理稿放资料库空间。回复给可打开的站内入口。',
    `本轮实际可用工具：${names.join('、')}。`].join('\n');
}
