// M5 乙路的事件（/v2/events，同一条流、同一套 id 和 Last-Event-ID 补发）：记了 / 改了 / 删了一笔账，站内信来了一封或
// 改了已读收藏归档（带铃上的未读数），工具组开关变了，云端浏览器的页面变了。每条带整行的视图，客户端按 id 换
// （有 version 的按 version）。2026-11-05 专注、自建提醒、成果删了，它们的事件一起删。

import { Type, type Static } from 'typebox';
import { BrowserViewSchema } from './browser.ts';
import { InboxRowViewSchema, InboxUnreadSchema } from './inbox.ts';
import { MoneyEntryViewSchema } from './money.ts';
import { ToolGroupViewSchema } from './tool-groups.ts';

export const MoneyChangedEventSchema = Type.Object({
  type: Type.Literal('money_changed'),
  entry: MoneyEntryViewSchema,
});

export const InboxChangedEventSchema = Type.Object({
  type: Type.Literal('inbox_changed'),
  message: InboxRowViewSchema,
  unread: InboxUnreadSchema,
});

export const ToolGroupChangedEventSchema = Type.Object({
  type: Type.Literal('tool_group_changed'),
  group: ToolGroupViewSchema,
});

export const BrowserChangedEventSchema = Type.Object({
  type: Type.Literal('browser_changed'),
  browser: BrowserViewSchema,
});

export const M5bStreamEventSchema = Type.Union([
  MoneyChangedEventSchema,
  InboxChangedEventSchema,
  ToolGroupChangedEventSchema,
  BrowserChangedEventSchema,
]);
export type M5bStreamEvent = Static<typeof M5bStreamEventSchema>;
