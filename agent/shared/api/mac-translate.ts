import { Type, type Static } from 'typebox';
import { TranslateDisplaySchema, TranslateTargetSchema, TRANSLATE_ITEM_MAX_CHARS } from './translate.ts';

const STRICT = { additionalProperties: false };
const TabId = Type.String({ minLength: 1, maxLength: 100 });
const RunId = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' });
const SegmentId = Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_:.-]+$' });
export const TRANSLATE_DELIVERY_MAX = 48;
export const TRANSLATE_ASK_MAX_CHARS = 8_000;

export const TranslatePageConfigSchema = Type.Object({
  run: RunId,
  target: TranslateTargetSchema,
  display: TranslateDisplaySchema,
}, STRICT);
export type TranslatePageConfig = Static<typeof TranslatePageConfigSchema>;

export const TranslateDeliverySchema = Type.Object({
  run: RunId,
  items: Type.Array(Type.Object({ id: SegmentId, text: Type.String() }, STRICT), { maxItems: TRANSLATE_DELIVERY_MAX }),
  failed: Type.Array(SegmentId, { maxItems: TRANSLATE_DELIVERY_MAX }),
}, STRICT);
export type TranslateDelivery = Static<typeof TranslateDeliverySchema>;

const RequestItem = Type.Object({
  id: SegmentId,
  text: Type.String({ minLength: 1, maxLength: TRANSLATE_ITEM_MAX_CHARS }),
}, STRICT);

const PAGE = { type: Type.Literal('page'), url: Type.String(), blocked: Type.Boolean() };
const REQUEST = {
  type: Type.Literal('request'),
  run: RunId,
  url: Type.String(),
  priority: Type.Union([Type.Literal('visible'), Type.Literal('ahead')]),
  fresh: Type.Boolean(),
  items: Type.Array(RequestItem, { minItems: 1, maxItems: TRANSLATE_DELIVERY_MAX }),
};
const PROGRESS = {
  type: Type.Literal('progress'),
  run: RunId,
  pending: Type.Integer({ minimum: 0 }),
  done: Type.Integer({ minimum: 0 }),
  failed: Type.Integer({ minimum: 0 }),
  chars: Type.Integer({ minimum: 0 }),
  firstScreenMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
};
const ASK = {
  type: Type.Literal('ask'),
  url: Type.String(),
  title: Type.String(),
  source: Type.String({ maxLength: TRANSLATE_ASK_MAX_CHARS }),
  translation: Type.String({ maxLength: TRANSLATE_ASK_MAX_CHARS }),
};

export const TranslatePageMessageSchema = Type.Union([
  Type.Object(PAGE, STRICT), Type.Object(REQUEST, STRICT), Type.Object(PROGRESS, STRICT), Type.Object(ASK, STRICT),
]);
export type TranslatePageMessage = Static<typeof TranslatePageMessageSchema>;

export const TranslateEventSchema = Type.Union([
  Type.Object({ ...PAGE, tabId: TabId }, STRICT),
  Type.Object({ ...REQUEST, tabId: TabId }, STRICT),
  Type.Object({ ...PROGRESS, tabId: TabId }, STRICT),
  Type.Object({ ...ASK, tabId: TabId }, STRICT),
]);
export type TranslateEvent = Static<typeof TranslateEventSchema>;

export interface PlasticineMacTranslate {
  configure(tabId: string, config: TranslatePageConfig | null): void;
  deliver(tabId: string, delivery: TranslateDelivery): void;
}
