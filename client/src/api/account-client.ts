import type {
  AccountPasswordRequest,
  AccountPasswordResponse,
  AccountSetupRequest,
  AccountSetupResponse,
  AccountState,
  HandleAvailability,
  OwnUrlView,
  WorkLimitSetting,
  WorkLimitView,
  PasswordSessionRequest,
  SessionView,
} from './shared.ts';

export interface AccountApi {
  state(signal?: AbortSignal): Promise<AccountState>;
  handle(handle: string, signal?: AbortSignal): Promise<HandleAvailability>;
  setup(input: AccountSetupRequest, localToken: string | null): Promise<AccountSetupResponse>;
  signIn(input: PasswordSessionRequest): Promise<SessionView>;
  signInLocal(deviceName: string, localToken: string): Promise<SessionView>;
  setPassword(input: AccountPasswordRequest, localToken: string | null): Promise<AccountPasswordResponse>;
  rename(displayName: string): Promise<AccountState>;
  ownUrl(signal?: AbortSignal): Promise<OwnUrlView>;
  setOwnUrl(ownUrl: string | null): Promise<OwnUrlView>;
  workLimit(signal?: AbortSignal): Promise<WorkLimitView>;
  setWorkLimit(setting: WorkLimitSetting): Promise<WorkLimitView>;
}
