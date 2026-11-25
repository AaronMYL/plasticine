import type { PlasticineApi } from '../../api/client.ts';
import { ApiError, errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { DailySettingsView, UpdateDailySettingsRequest } from '../../api/types.ts';
import { isOpenOp, type ActionOps, type ActionRequest } from '../../state/action-ops.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import { DAILY_SETTINGS_OP_KEY } from '../../state/daily-action-requests.ts';
import { Store } from '../../state/store.ts';
import type { LoadStatus } from '../../state/load.ts';
import { isTimeZone } from '../../../../agent/shared/time-zone.ts';

export const SETTING_FIELDS = ['timeZone'] as const;
export type SettingField = (typeof SETTING_FIELDS)[number];

export function settingDraftKey(field: SettingField): string {
  return `settings:daily:${field}`;
}

export interface DailySettingsData {
  status: LoadStatus;
  error: string | null;
  settings: DailySettingsView | null;
}

export interface DailySettingsDeps {
  api: PlasticineApi;
  ops: ActionOps;
  drafts: InlineDrafts;
  onSaved: () => void;
}

function valueOf(settings: DailySettingsView, field: SettingField): string {
  return String(settings[field] ?? '');
}

export class DailySettingsStore {
  readonly data = new Store<DailySettingsData>({ status: 'idle', error: null, settings: null });
  private readonly deps: DailySettingsDeps;

  constructor(deps: DailySettingsDeps) {
    this.deps = deps;
  }

  open(): void {
    const { status } = this.data.get();
    if (status === 'idle' || status === 'failed') {
      void this.reload();
    }
  }

  async reload(): Promise<void> {
    this.data.set((data) => ({ ...data, status: data.settings === null ? 'loading' : data.status, error: null }));
    try {
      const settings = await this.deps.api.today.settings();
      this.data.set({ status: 'ready', error: null, settings });
    } catch (cause) {
      this.data.set((data) => ({ ...data, status: 'failed', error: errorText(cause) }));
    }
  }

  field(field: SettingField): string {
    const draft = this.deps.drafts.get(settingDraftKey(field));
    const settings = this.data.get().settings;
    if (draft !== '' || settings === null) {
      return draft.trim();
    }
    return valueOf(settings, field);
  }

  change(field: SettingField, value: string): void {
    const settings = this.data.get().settings;
    const same = settings !== null && valueOf(settings, field) === value;
    let stored = value;
    if (same) {
      stored = '';
    } else if (value === '') {
      stored = ' ';
    }
    this.deps.drafts.set(settingDraftKey(field), stored);
  }

  problem(): string | null {
    const timeZone = this.field('timeZone');
    if (timeZone !== '' && !isTimeZone(timeZone)) {
      return '时区要用 IANA 名称，例如 Asia/Shanghai、America/Chicago；留空使用设备时区。';
    }
    return null;
  }

  hasChanges(): boolean {
    return SETTING_FIELDS.some((field) => this.deps.drafts.get(settingDraftKey(field)) !== '');
  }

  discard(): void {
    for (const field of SETTING_FIELDS) {
      this.deps.drafts.clear(settingDraftKey(field));
    }
  }

  async save(): Promise<void> {
    const settings = this.data.get().settings;
    const pending = this.deps.ops.get(DAILY_SETTINGS_OP_KEY);
    if (pending !== undefined && isOpenOp(pending)) {
      await this.retry();
      return;
    }
    if (settings === null || this.problem() !== null || !this.hasChanges()) {
      return;
    }
    this.deps.ops.dismiss(DAILY_SETTINGS_OP_KEY);
    const changes: Omit<UpdateDailySettingsRequest, 'requestId' | 'version'> = {
      timeZone: this.field('timeZone') || null,
    };
    const request = this.deps.ops.begin(
      DAILY_SETTINGS_OP_KEY,
      '保存',
      '时区',
      (requestId) => ({ kind: 'daily_settings', body: { requestId, version: settings.version, ...changes } }),
      createRequestId,
    );
    await this.perform(request);
  }

  async retry(): Promise<void> {
    const request = this.deps.ops.retry(DAILY_SETTINGS_OP_KEY);
    if (request !== undefined) {
      await this.perform(request);
    }
  }

  dismiss(): void {
    this.deps.ops.dismiss(DAILY_SETTINGS_OP_KEY);
  }

  private async perform(request: ActionRequest): Promise<void> {
    if (request.kind !== 'daily_settings') {
      return;
    }
    try {
      const settings = await this.deps.api.today.saveSettings(request.body);
      this.deps.ops.succeed(DAILY_SETTINGS_OP_KEY);
      this.data.set({ status: 'ready', error: null, settings });
      for (const field of SETTING_FIELDS) {
        this.deps.drafts.clear(settingDraftKey(field));
      }
      this.deps.onSaved();
    } catch (cause) {
      this.deps.ops.fail(DAILY_SETTINGS_OP_KEY, cause);
      if (cause instanceof ApiError && cause.kind === 'conflict') {
        await this.reload();
      }
    }
  }
}
