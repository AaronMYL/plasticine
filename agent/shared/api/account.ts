import { Type, type Static } from 'typebox';
import { DeviceNameSchema } from '../state.ts';
import { API_PREFIX, IsoTimeSchema } from './common.ts';
import { NETWORK_HANDLE_PATTERN } from './network.ts';
import { SessionViewSchema } from './session.ts';

export const ACCOUNT_PATH = `${API_PREFIX}/account`;
export const ACCOUNT_STATE_PATH = `${ACCOUNT_PATH}/state`;
export const ACCOUNT_SETUP_PATH = `${ACCOUNT_PATH}/setup`;
export const ACCOUNT_PASSWORD_PATH = `${ACCOUNT_PATH}/password`;
export const ACCOUNT_HANDLES_PATH = `${ACCOUNT_PATH}/handles`;
export const PASSWORD_SESSION_PATH = `${API_PREFIX}/session/password`;
export const LOCAL_SESSION_PATH = `${API_PREFIX}/session/local`;
export const ACCOUNT_OWN_URL_PATH = `${ACCOUNT_PATH}/own-url`;
export const ACCOUNT_WORK_LIMIT_PATH = `${ACCOUNT_PATH}/work-limit`;

export const LOCAL_TOKEN_HEADER = 'x-plasticine-local-token';
export const LOCAL_TOKEN_ENV = 'PLASTICINE_LOCAL_TOKEN';

export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_CHARS = 200;
export const PasswordSchema = Type.String({ minLength: PASSWORD_MIN_CHARS, maxLength: PASSWORD_MAX_CHARS });
export const DISPLAY_NAME_MAX_CHARS = 40;
export const DisplayNameSchema = Type.String({ minLength: 1, maxLength: DISPLAY_NAME_MAX_CHARS });
export const HandleSchema = Type.String({ pattern: NETWORK_HANDLE_PATTERN });
export const SetupTokenSchema = Type.String({ minLength: 8, maxLength: 64 });
export const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;

export const AccountStateSchema = Type.Object({
  setup: Type.Union([Type.Literal('needed'), Type.Literal('done')]),
  handle: Type.Union([HandleSchema, Type.Null()]),
  displayName: Type.Union([Type.String(), Type.Null()]),
  passwordSet: Type.Boolean(),
  networkUrl: Type.Union([Type.String(), Type.Null()]),
}, { additionalProperties: false });
export type AccountState = Static<typeof AccountStateSchema>;

export const AccountSetupRequestSchema = Type.Object({
  displayName: DisplayNameSchema,
  handle: Type.Union([HandleSchema, Type.Null()]),
  password: PasswordSchema,
  deviceName: DeviceNameSchema,
  setupToken: Type.Optional(SetupTokenSchema),
}, { additionalProperties: false });
export type AccountSetupRequest = Static<typeof AccountSetupRequestSchema>;

export const AccountSetupResponseSchema = Type.Object({
  session: SessionViewSchema,
  network: Type.Object({
    joined: Type.Boolean(),
    url: Type.Union([Type.String(), Type.Null()]),
    problem: Type.Union([Type.String(), Type.Null()]),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
export type AccountSetupResponse = Static<typeof AccountSetupResponseSchema>;

export const HandleAvailabilitySchema = Type.Object({
  handle: Type.String(),
  available: Type.Boolean(),
  reason: Type.Union([Type.Literal('taken'), Type.Literal('invalid'), Type.Literal('reserved'),
    Type.Literal('unreachable'), Type.Null()]),
}, { additionalProperties: false });
export type HandleAvailability = Static<typeof HandleAvailabilitySchema>;

export const PasswordSessionRequestSchema = Type.Object({
  password: Type.String({ minLength: 1, maxLength: PASSWORD_MAX_CHARS }),
  deviceName: DeviceNameSchema,
}, { additionalProperties: false });
export type PasswordSessionRequest = Static<typeof PasswordSessionRequestSchema>;

export const LocalSessionRequestSchema = Type.Object({ deviceName: DeviceNameSchema },
  { additionalProperties: false });

export const AccountPasswordRequestSchema = Type.Object({
  current: Type.Optional(Type.String({ maxLength: PASSWORD_MAX_CHARS })),
  password: PasswordSchema,
}, { additionalProperties: false });
export type AccountPasswordRequest = Static<typeof AccountPasswordRequestSchema>;

export const AccountPasswordResponseSchema = Type.Object({ passwordSetAt: IsoTimeSchema },
  { additionalProperties: false });
export type AccountPasswordResponse = Static<typeof AccountPasswordResponseSchema>;

export const AccountPatchRequestSchema = Type.Object({ displayName: DisplayNameSchema },
  { additionalProperties: false });

export const OWN_URL_MAX_CHARS = 300;
export const OwnUrlViewSchema = Type.Object({
  ownUrl: Type.Union([Type.String({ maxLength: OWN_URL_MAX_CHARS }), Type.Null()]),
}, { additionalProperties: false });
export type OwnUrlView = Static<typeof OwnUrlViewSchema>;
export const OwnUrlRequestSchema = OwnUrlViewSchema;

export { WelcomeStartSchema, type WelcomeStart } from '../welcome-start.ts';

export const WORK_LIMIT_AUTO = 'auto';
export const WORK_LIMIT_MAX = 8;
export const WorkLimitSettingSchema = Type.Union([Type.Literal(WORK_LIMIT_AUTO),
  Type.Integer({ minimum: 1, maximum: WORK_LIMIT_MAX })]);
export type WorkLimitSetting = Static<typeof WorkLimitSettingSchema>;
export const WorkLimitViewSchema = Type.Object({
  setting: WorkLimitSettingSchema,
  effective: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });
export type WorkLimitView = Static<typeof WorkLimitViewSchema>;
export const WorkLimitRequestSchema = Type.Object({ setting: WorkLimitSettingSchema }, { additionalProperties: false });
