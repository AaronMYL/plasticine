import { Type } from 'typebox';
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

export const ToolGroupStreamEventSchema = Type.Union([
  MoneyChangedEventSchema,
  InboxChangedEventSchema,
  ToolGroupChangedEventSchema,
  BrowserChangedEventSchema,
]);
