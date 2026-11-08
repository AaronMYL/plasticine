// 壳自己的设置（userData/settings.json）：本体跑在哪、系统通知开关、设备服务暂停、授权目录。整份读、整份写，
// 写时先写同目录临时文件再改名。读到坏文件不覆盖：挪成 settings.json.broken-<时间> 留着，再用默认值（不删数据）。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { ServerChoiceSchema, type ServerChoice } from '../../../agent/shared/api/desktop-bridge.ts';

/** 授权目录最多这么多个（和设备上限的目录清单同档）。 */
const ROOTS_MAX = 50;

export const DesktopSettingsSchema = Type.Object({
  schema: Type.Literal(1),
  server: ServerChoiceSchema,
  notifications: Type.Boolean(),
  devicePaused: Type.Boolean(),
  /** 本机授权目录：文件动作和命令的工作目录只在这些目录里；空表示不授权。默认是整个家目录（和 Mac 壳一样）。 */
  roots: Type.Array(Type.String({ minLength: 1, maxLength: 4_096 }), { maxItems: ROOTS_MAX }),
}, { additionalProperties: false });
export type DesktopSettings = Static<typeof DesktopSettingsSchema>;

export function defaultSettings(server: ServerChoice, home: string): DesktopSettings {
  return { schema: 1, server, notifications: true, devicePaused: false, roots: [home] };
}

export class SettingsStore {
  private readonly file: string;
  private current: DesktopSettings;

  /** fallback：没有设置文件（第一次打开）或文件坏了时用的那一份。 */
  constructor(file: string, fallback: () => DesktopSettings, log: (line: string) => void, now = () => new Date()) {
    this.file = file;
    this.current = SettingsStore.load(file, fallback, log, now);
    if (!existsSync(file)) {
      this.write();
    }
  }

  /** 这台电脑以前没打开过 Electron 版（第一次启动时决定默认值用）。 */
  static firstRun(file: string): boolean {
    return !existsSync(file);
  }

  get(): DesktopSettings {
    return structuredClone(this.current);
  }

  update(change: (settings: DesktopSettings) => DesktopSettings): DesktopSettings {
    const next = change(this.get());
    if (!Value.Check(DesktopSettingsSchema, next)) {
      throw new Error('设置的形状不对，没有保存。');
    }
    this.current = next;
    this.write();
    return this.get();
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.partial-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(this.current, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.file);
  }

  private static load(file: string, fallback: () => DesktopSettings, log: (line: string) => void,
    now: () => Date): DesktopSettings {
    if (!existsSync(file)) {
      return fallback();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      raw = null;
    }
    if (Value.Check(DesktopSettingsSchema, raw)) {
      return raw;
    }
    const kept = `${file}.broken-${now().toISOString().replace(/[:.]/g, '-')}`;
    renameSync(file, kept);
    log(`设置文件读不懂，原样挪到 ${kept}，这次用默认设置。`);
    return fallback();
  }
}
