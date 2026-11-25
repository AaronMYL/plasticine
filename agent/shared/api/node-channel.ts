import { Type, type Static } from 'typebox';
import { DeviceActionKindSchema, type DeviceActionKind } from '../state-devices.ts';
import { IdSchema, IsoTimeSchema } from './common.ts';
import { DESK_RESULT_SCHEMAS } from './device-desk.ts';
import { IOS_RESULT_SCHEMAS } from './device-ios.ts';
import { PageActResultSchema, PagePerceptionSchema } from './page-operate.ts';
import { NODE_ACTIONS_PATH } from './devices.ts';

const STRICT = { additionalProperties: false };
export const NODE_NEXT_ACTION_PATH = `${NODE_ACTIONS_PATH}/next`;
export const NODE_POLL_MAX_SECONDS = 25;
export const NODE_ONLINE_MS = 90_000;
export const NODE_HELLO_EVERY_MS = 20_000;
export const NODE_RESULT_MAX_BYTES = 24 * 1024 * 1024;
export const NodeNextActionQuerySchema = Type.Object({
  wait: Type.Optional(Type.String({ pattern: '^(?:[0-9]|1[0-9]|2[0-5])$' })),
}, STRICT);

export const NodeWireActionSchema = Type.Object({
  id: IdSchema,
  kind: DeviceActionKindSchema,
  params: Type.Record(Type.String(), Type.Unknown()),
  deadline: IsoTimeSchema,
}, STRICT);
export type NodeWireAction = Static<typeof NodeWireActionSchema>;
export const NodeNextActionResponseSchema = Type.Object({ action: NodeWireActionSchema }, STRICT);

export const DEVICE_FAILURE_CODES = ['screenshot_stale', 'user_present', 'submit_needs_you', 'page_stale', 'timed_out',
  'cancelled'] as const;
export type DeviceFailureCode = (typeof DEVICE_FAILURE_CODES)[number];
export const DeviceTimeoutSchema = Type.Object({
  step: Type.String({ maxLength: 200 }),
  afterMs: Type.Integer({ minimum: 0 }),
  retryable: Type.Boolean(),
}, STRICT);
export type DeviceTimeout = Static<typeof DeviceTimeoutSchema>;

export const NodeActionResultRequestSchema = Type.Object({
  status: Type.Union([Type.Literal('executed'), Type.Literal('failed'), Type.Literal('refused')]),
  result: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  error: Type.Optional(Type.String()),
  errorCode: Type.Optional(Type.Enum(DEVICE_FAILURE_CODES)),
  refusalLayer: Type.Optional(Type.Literal('device')),
  timedOut: Type.Optional(DeviceTimeoutSchema),
}, STRICT);
export type NodeActionResultRequest = Static<typeof NodeActionResultRequestSchema>;

const Version = Type.String({ pattern: '^[a-f0-9]{64}$' });
const Empty = Type.Object({}, STRICT);
export const DeviceAfterShotSchema = Type.Object({ sha256: Version, width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }), capturedAt: IsoTimeSchema, beforeSha256: Type.Optional(Version) }, STRICT);
const InputResult = Type.Object({ afterShot: Type.Optional(DeviceAfterShotSchema),
  changed: Type.Optional(Type.Boolean()) }, STRICT);

export const TAB_READ_LINKS_MAX = 40;
export const TAB_READ_FIELDS_MAX = 30;
const Text = Type.String();
const TabIdText = Type.String({ minLength: 1 });
export const WebTabSummarySchema = Type.Object({ tabId: TabIdText, url: Text, title: Text, active: Type.Boolean(),
  loading: Type.Boolean() }, STRICT);
export const WebTabFieldSchema = Type.Object({ selector: Text, tag: Text, type: Text, name: Text, label: Text,
  value: Type.Union([Text, Type.Null()]), checked: Type.Union([Type.Boolean(), Type.Null()]),
  disabled: Type.Boolean() }, STRICT);
export const WebTabDomStateSchema = Type.Object({ url: Text, title: Text, digest: Version }, STRICT);
const TabPage = { tabId: TabIdText, url: Text, title: Text, loaded: Type.Boolean() };
export const DEVICE_RESULT_SCHEMAS = {
  file_list: Type.Object({ entries: Type.Array(Type.Object({
    name: Type.String(), type: Type.Union([Type.Literal('file'), Type.Literal('dir'), Type.Literal('link')]),
    size: Type.Number({ minimum: 0 }), modifiedAt: IsoTimeSchema,
  }, STRICT)) }, STRICT),
  file_read: Type.Object({ content: Type.String(),
    encoding: Type.Union([Type.Literal('utf8'), Type.Literal('base64')]), version: Version }, STRICT),
  file_write: Type.Object({ version: Version }, STRICT),
  file_delete: Empty,
  run_command: Type.Object({ exitCode: Type.Integer(), stdout: Type.String(), stderr: Type.String(),
    truncated: Type.Boolean() }, STRICT),
  browser_open: Empty,
  browser_read: Type.Object({ text: Type.String(), truncated: Type.Boolean() }, STRICT),
  screen_capture: Type.Object({ png: Type.String(), width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }) }, STRICT),
  input_click: InputResult,
  input_type: InputResult,
  app_open: Empty,
  tab_list: Type.Object({ tabs: Type.Array(WebTabSummarySchema),
    viewing: Type.Union([TabIdText, Type.Null()]) }, STRICT),
  tab_read: Type.Object({ tabId: TabIdText, url: Text, title: Text, text: Text,
    offset: Type.Integer({ minimum: 0 }), totalChars: Type.Integer({ minimum: 0 }),
    nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    links: Type.Array(Type.Object({ text: Text, href: Text }, STRICT), { maxItems: TAB_READ_LINKS_MAX }),
    fields: Type.Array(WebTabFieldSchema, { maxItems: TAB_READ_FIELDS_MAX }),
    linksTruncated: Type.Boolean(), fieldsTruncated: Type.Boolean() }, STRICT),
  tab_open: Type.Object(TabPage, STRICT),
  tab_navigate: Type.Object(TabPage, STRICT),
  tab_click: Type.Object({ tabId: TabIdText, target: Type.Object({ tag: Text, text: Text }, STRICT),
    before: WebTabDomStateSchema, after: WebTabDomStateSchema, changed: Type.Boolean() }, STRICT),
  tab_fill: Type.Object({ tabId: TabIdText, selector: Text, tag: Text, type: Text, matches: Type.Boolean() }, STRICT),
  tab_perceive: Type.Object({ tabId: TabIdText, ...PagePerceptionSchema.properties }, STRICT),
  tab_act: PageActResultSchema,
  tab_shot: Type.Object({ tabId: TabIdText, url: Text, jpeg: Type.String(), width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }) }, STRICT),
  tab_point: Type.Object({ tabId: TabIdText, target: Type.Object({ tag: Text, text: Text }, STRICT),
    before: WebTabDomStateSchema, after: WebTabDomStateSchema, changed: Type.Boolean() }, STRICT),
  tab_close: Type.Object({ tabId: TabIdText }, STRICT),
  tab_wait: Type.Object({ tabId: TabIdText, met: Type.Boolean(), waitedMs: Type.Integer({ minimum: 0 }) }, STRICT),
  tab_type: Type.Object({ tabId: TabIdText, tag: Text, matches: Type.Boolean() }, STRICT),
  tab_key: Type.Object({ tabId: TabIdText, key: Text, before: WebTabDomStateSchema, after: WebTabDomStateSchema,
    changed: Type.Boolean() }, STRICT),
  tab_scroll: Type.Object({ tabId: TabIdText, moved: Type.Boolean() }, STRICT),
  tab_paste: Type.Object({ tabId: TabIdText, tag: Text, handled: Type.Boolean(), matches: Type.Boolean() }, STRICT),
  tab_show: Type.Object({ tabId: TabIdText }, STRICT),
  tab_upload: Type.Object({ tabId: TabIdText, files: Type.Array(Text), via: Type.Union([Type.Literal('input'),
    Type.Literal('chooser')]) }, STRICT),
  file_fetch: Type.Object({ path: Text, name: Text, bytes: Type.Integer({ minimum: 0 }), base64: Type.String() },
    STRICT),
  file_put: Type.Object({ path: Text, bytes: Type.Integer({ minimum: 0 }) }, STRICT),
  ...DESK_RESULT_SCHEMAS,
  ...IOS_RESULT_SCHEMAS,
} satisfies Record<DeviceActionKind, object>;

export const DeviceProofSchema = Type.Object({ proven: Type.Boolean(), rule: Type.String(),
  detail: Type.String() }, STRICT);
export type DeviceProof = Static<typeof DeviceProofSchema>;
