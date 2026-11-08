// 第三级：留下来的旧工具，每件在新内核里怎么说自己（界面上一步一行的大白话）、属不属于硬线。
// 他 11-05 列的要留的：笔记、记忆文档、记住一句、项目、设备动作与设备列表、云浏览器、服务器命令、收件箱、书、记账、
// 附件文字、卡片小部件、技能、问他、提交前问他、取时间。不移植的（任务、委派、计划、报告、验收、≠、自迭代……）不在这里。
// 硬线：这些旧工具都没有单独的硬线——设备动作有自己的上限和逐次确认卡（devices/lanes.ts），服务器是 Plasticine 自己的
// 电脑（第 97 条，不加审批），记账只是出草稿等他确认，云浏览器第 97 条起不逐次批准。新加的对外工具在这里声明硬线。

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
    // 不是完整网址（模型只写了域名之类）：照原样说。
    return url;
  }
}

function withSubject(prefix: string, subject: string): string {
  return subject === '' ? prefix : `${prefix}：${subject}`;
}

/** 设备在大白话里叫什么（「Mac」「iPhone」），由 assemble 按节点的平台给。 */
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
    device_action: { say: (args) => `在 ${nodeLabel(text(args, 'nodeId'))} 上${text(args, 'purpose') || '做一步'}` },
    cloud_browser_open: { say: (args) => withSubject('在云端浏览器打开', host(text(args, 'url'))) },
    cloud_browser_read: { say: () => '在云端浏览器读网页' },
    cloud_browser_observe: { say: () => '在云端浏览器看画面' },
    cloud_browser_act: { say: () => '在云端浏览器操作网页' },
    server_command_read: { say: () => '看命令的输出' },
    list_inbox: { say: (args) => withSubject('看收件箱', text(args, 'query')) },
    read_inbox: { say: () => '读一封邮件' },
    book_list: { say: () => '看图书馆' },
    book_search: { say: (args) => withSubject('在书里找', text(args, 'q')) },
    book_read: { say: () => '读书' },
    book_annotations: { say: () => '看读书标注' },
    propose_payment: { say: () => '从截图里认一笔账' },
    attachment_text: { say: (args) => withSubject('读附件', text(args, 'path')) },
    show_widgets: { say: () => '在回复里放卡片' },
    skills_search: { say: (args) => withSubject('查技能目录', text(args, 'query')) },
    skill_read: { say: (args) => withSubject('读技能', text(args, 'name')) },
    skill_write: { say: (args) => withSubject('写技能', text(args, 'name')) },
  };
}

/** 新内核里留下的旧工具名（按上面的顺序）。 */
export function legacyToolNames(): string[] {
  return Object.keys(legacySayings(() => ''));
}
