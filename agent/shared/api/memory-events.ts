// 记忆在 /v2/events 上的事件：一条旧记忆条目或一条约定变了（任何设备上的改动、确认）。都带整个视图，客户端按 id 换那一行。
// 2026-11-05 判断和 ≠ 标记删了，它们的两种事件一起删。

import { Type, type Static } from 'typebox';
import { AgreementViewSchema } from './agreements.ts';
import { MemoryEntryViewSchema } from './memory.ts';

export const MemoryEntryChangedEventSchema = Type.Object({
  type: Type.Literal('memory_entry_changed'),
  entry: MemoryEntryViewSchema,
});

export const AgreementChangedEventSchema = Type.Object({
  type: Type.Literal('agreement_changed'),
  agreement: AgreementViewSchema,
});

export const MemoryStreamEventSchema = Type.Union([
  MemoryEntryChangedEventSchema,
  AgreementChangedEventSchema,
]);
export type MemoryStreamEvent = Static<typeof MemoryStreamEventSchema>;
