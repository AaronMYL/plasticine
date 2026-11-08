import { Type, type Static } from 'typebox';
import { BrowserActionInputSchema } from './api/browser.ts';

export const BrowserElementSchema = Type.Object({
  id: Type.String(), tag: Type.String(), role: Type.String(), text: Type.String(), label: Type.String(),
  disabled: Type.Boolean(), focused: Type.Boolean(),
  bounds: Type.Object({ x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() }),
});
export const BrowserInspectionSchema = Type.Object({
  url: Type.String(), title: Type.String(), documentId: Type.Number(), text: Type.String(),
  viewport: Type.Object({ width: Type.Number(), height: Type.Number(), scrollX: Type.Number(), scrollY: Type.Number() }),
  elements: Type.Array(BrowserElementSchema, { maxItems: 60 }),
});
export type BrowserInspection = Static<typeof BrowserInspectionSchema>;
export const BrowserObserveSchema = Type.Object({
  tabId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false });
export const BrowserToolActionSchema = Type.Object({
  action: BrowserActionInputSchema,
  observationId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
}, { additionalProperties: false });
