// 更新目录里的备份怎么留（2026-11-13 他定）：同一样东西最多留最新 2 份，每份从生成那一刻起满 7 天就删，两条同时生效，
// 不够 2 份也照样到期删。生成时间用 state.json 里登记的，不看文件的访问时间，所以打开、复制都不会重新计时；老版本留下、
// 没登记的，才退到看文件自己的修改时间。
// 以前这里从不清：每次更新的安装包都留在 downloads/<版本>/（Mac 一版 329M），一天发几版，几天就是几个 G。
//   downloads/<版本>/      下好的更新包：装上就没用了，只留「下好还没装」的那一版
//   staging/<版本>/        Mac 解包、重签的地方：换完版本就是残留
//   installers/<版本>.exe  Windows 回退用的安装程序：最新 2 份、7 天
//   previous/              Mac 回退用的上一版：1 份、7 天
//   started-<版本>          「新版起来了」的记号：只留当前这一版的
//   rolled-back.json.<毫秒> 坏版本退回的旧记录：7 天

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const KEEP_COPIES = 2;
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupInput {
  /** 更新目录（<用户数据>/updates）。 */
  directory: string;
  platform: 'darwin' | 'win32' | 'linux';
  /** 正在跑的版本（规范写法）。 */
  current: string;
  /** 下好还没装、或正在下的版本：它的更新包不动。 */
  holding: string | null;
  /** 各份备份的生成时间：`previous`、`installer:<版本>` → ISO 时间。 */
  createdAt: Readonly<Record<string, string>>;
  now: Date;
  /** Windows：登记的上一版；它的安装程序没了，就不能回退了。 */
  previous?: string | null;
}

export interface CleanupResult {
  /** 删掉了什么（相对更新目录的路径）。 */
  removed: string[];
  /** 回退用的上一版没了（到期删了，或者本来就不在）。 */
  previousGone: boolean;
}

function entries(directory: string): string[] {
  return existsSync(directory) ? readdirSync(directory) : [];
}

function createdMs(recorded: string | undefined, path: string): number {
  const parsed = recorded === undefined ? Number.NaN : Date.parse(recorded);
  return Number.isFinite(parsed) ? parsed : statSync(path).mtimeMs;
}

export function cleanUpdates(input: CleanupInput): CleanupResult {
  const { directory, now } = input;
  const removed: string[] = [];
  if (!existsSync(directory)) {
    return { removed, previousGone: false };
  }
  const remove = (relative: string): void => {
    rmSync(join(directory, relative), { recursive: true, force: true });
    removed.push(relative);
  };
  const expired = (created: number): boolean => now.getTime() - created >= KEEP_MS;

  for (const version of entries(join(directory, 'downloads'))) {
    if (version !== input.holding) remove(`downloads/${version}`);
  }
  for (const version of entries(join(directory, 'staging'))) {
    remove(`staging/${version}`);
  }
  for (const name of entries(directory)) {
    if (name.startsWith('started-') && name !== `started-${input.current}`) remove(name);
    const rolledAt = /^rolled-back\.json\.(\d+)$/.exec(name)?.[1];
    if (rolledAt !== undefined && expired(Number(rolledAt))) remove(name);
  }

  let previousGone = false;
  if (input.platform === 'win32') {
    const installers = entries(join(directory, 'installers')).filter((name) => name.endsWith('.exe')).map((name) => {
      const version = name.slice(0, -'.exe'.length);
      return { name, version, created: createdMs(input.createdAt[`installer:${version}`],
        join(directory, 'installers', name)) };
    }).sort((a, b) => b.created - a.created || b.version.localeCompare(a.version, undefined, { numeric: true }));
    const kept = new Set(installers.filter((item) => !expired(item.created)).slice(0, KEEP_COPIES)
      .map((item) => item.version));
    for (const item of installers) {
      if (!kept.has(item.version)) remove(`installers/${item.name}`);
    }
    previousGone = input.previous != null && !kept.has(input.previous);
  } else if (existsSync(join(directory, 'previous'))) {
    const app = join(directory, 'previous', 'Plasticine.app');
    if (!existsSync(app) || expired(createdMs(input.createdAt['previous'], app))) {
      remove('previous');
      previousGone = true;
    }
  }
  return { removed, previousGone };
}
