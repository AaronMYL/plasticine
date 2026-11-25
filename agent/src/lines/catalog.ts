import type { LegacyMeta } from './legacy.ts';
import type { ToolArgs } from './types.ts';

function text(args: ToolArgs, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function withSubject(prefix: string, subject: string): string {
  return subject === '' ? prefix : `${prefix}：${subject}`;
}

export type NodeLabel = (nodeId: string) => string;

export function legacySayings(nodeLabel: NodeLabel): Readonly<Record<string, LegacyMeta>> {
  return {
    get_time: { say: () => '看一眼现在几点' },
    note_search: { say: (args) => withSubject('找笔记', text(args, 'q')) },
    note_read: { say: () => '读一篇笔记' },
    note_append: { say: (args) => withSubject('记到笔记', text(args, 'title')) },
    read_memory_doc: { say: (args) => withSubject('读记忆', text(args, 'name')) },
    search_memory: { say: (args) => withSubject('搜记忆', text(args, 'query')) },
    list_projects: { say: () => '看项目一览' },
    read_project: { say: () => '读项目档案' },
    create_project: { say: (args) => withSubject('新建项目', text(args, 'name')) },
    update_project: { say: () => '更新项目' },
    file_to_project: { say: (args) => withSubject('归到项目', text(args, 'title')) },
    device_nodes: { say: () => '看有哪些设备' },
    device_logs: { say: (args) => `查 ${nodeLabel(text(args, 'nodeId'))} 出了什么事` },
    device_cancel: { say: () => '取消一个设备动作' },
    device_action: { say: (args) => `在 ${nodeLabel(text(args, 'nodeId'))} 上${text(args, 'purpose') || '做一步'}` },
    page_send: { say: (args) => `在 ${text(args, 'site')} 上发给${text(args, 'to') || '对方'}`,
      consequence: () => '会以你的名义发出，对方会收到，撤不回。' },
    cloud_browser_open: { say: (args) => withSubject('在云端浏览器打开', host(text(args, 'url'))) },
    cloud_browser_read: { say: () => '在云端浏览器读网页' },
    cloud_browser_observe: { say: () => '在云端浏览器看画面' },
    cloud_browser_act: { say: () => '在云端浏览器操作网页' },
    cloud_browser_tabs: { say: () => '看云端浏览器开着哪些标签' },
    cloud_browser_close: { say: () => '关一个云端浏览器标签' },
    server_command_read: { say: () => '看命令的输出' },
    server_health: { say: () => '给服务做个体检' },
    list_inbox: { say: (args) => withSubject('看收件箱', text(args, 'query')) },
    read_inbox: { say: () => '读一封邮件' },
    book_list: { say: () => '看图书馆' },
    book_search: { say: (args) => withSubject('在书里找', text(args, 'q')) },
    book_read: { say: () => '读书' },
    book_annotations: { say: () => '看读书标注' },
    propose_payment: { say: () => '从截图里认一笔账' },
    attachment_text: { say: (args) => withSubject('读附件', text(args, 'path')) },
    web_search: { say: (args) => withSubject('搜网页', text(args, 'query')) },
    connection_tools: { say: (args) => withSubject('看连接的工具', text(args, 'connection')) },
    connection_call: { say: (args) => `用「${text(args, 'connection')}」的 ${text(args, 'tool')}`,
      consequence: () => '会改你在这个服务里的东西。' },
    mail_send: { say: (args) => withSubject('发邮件', text(args, 'subject')),
      consequence: () => '会用你的邮箱发出，对方会收到，撤不回。' },
    web_fetch: { say: (args) => withSubject('读网页', host(text(args, 'url'))) },
    show_widgets: { say: () => '在回复里放卡片' },
    skills_search: { say: (args) => withSubject('查技能目录', text(args, 'query')) },
    skill_read: { say: (args) => withSubject('读技能', text(args, 'name')) },
    skill_write: { say: (args) => withSubject('写技能', text(args, 'name')) },
  };
}

export function legacyToolNames(): string[] {
  return Object.keys(legacySayings(() => ''));
}
