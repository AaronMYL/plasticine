import { Type } from 'typebox';
import { MemoryEntryViewSchema } from './memory.ts';

export const MemoryEntryChangedEventSchema = Type.Object({
  type: Type.Literal('memory_entry_changed'),
  entry: MemoryEntryViewSchema,
});

export const MemoryStreamEventSchema = Type.Union([
  MemoryEntryChangedEventSchema,
]);
