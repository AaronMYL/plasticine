// 设置 · 通用里「时区」的数据（GET / PUT /v2/today/settings 里的 timeZone）。2026-11-08 第 7 批：「日常」那一栏删了，
// 十件事上限、离开多久算回来、每天回看（和早先隐藏的采访开关、每天几题）11-06 起没有代码在读，界面不再读写它们；
// 服务端 schema 不动（这些字段在 PUT 里本来可选，不带就不改）。
// 改了的字存在 inline-drafts（`settings:daily:<字段>`，切页、刷新都在、算进离开提醒），点「保存」才提交；标识和请求体
// 存在 state/action-ops，回执丢了原样重发。别处改过（409）就重读一次设置，草稿留着再存。

import type { PlasticineApi } from '../../api/client.ts';
import { ApiError, errorText } from '../../api/errors.ts';
import { createRequestId } from '../../api/request-id.ts';
import type { DailySettingsView, UpdateDailySettingsRequest } from '../../api/types.ts';
import { isOpenOp, type ActionOps, type ActionRequest } from '../../state/action-ops.ts';
import type { InlineDrafts } from '../../state/inline-drafts.ts';
import { DAILY_SETTINGS_OP_KEY } from '../../state/m4-action-requests.ts';
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
  /** 存上了。 */
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

  /** 输入框里显示的：草稿，没有草稿就是服务端现在的值。 */
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
    // 改回和服务端一样就不算草稿（不让离开提醒白问一句）。清空了的框记成一个空格：草稿写空就是删掉，那样框里会
    // 弹回服务端的值、没法重新输入。
    const same = settings !== null && valueOf(settings, field) === value;
    let stored = value;
    if (same) {
      stored = '';
    } else if (value === '') {
      stored = ' ';
    }
    this.deps.drafts.set(settingDraftKey(field), stored);
  }

  /** 填的数不在范围里：返回一句说明，保存按钮不可点。 */
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

  /** 设置弹框里点了「放弃修改」：草稿全清，框里回到服务端现在的值。 */
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
        // 别处改过：读一份现在的，草稿留着，再点保存按新版本存。
        await this.reload();
      }
    }
  }
}
