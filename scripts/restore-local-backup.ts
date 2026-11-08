// 本机离线恢复到新目录；不下载、不覆盖、不切换服务。完成后按 docs/backup-recovery.md 核对与切换。
import { prepareOfflineRestore } from '../agent/src/state/index.ts';
const [stateDirectory, backupId, destination] = process.argv.slice(2);
if (stateDirectory === undefined || backupId === undefined || destination === undefined) {
  process.stderr.write('用法：restore-local-backup.ts 当前状态目录 备份标识 全新恢复目录\n');
  process.exitCode = 2;
} else {
  try {
    prepareOfflineRestore({ stateDirectory, backupId, destination, enforceOwner: true });
    process.stdout.write('已生成隔离恢复目录和当前安全快照；尚未切换服务。请按恢复文档核对。\n');
  } catch {
    process.stderr.write('离线恢复未完成；原库未改动，输出目录保留供核对。请检查备份、权限和目标目录。\n');
    process.exitCode = 1;
  }
}
