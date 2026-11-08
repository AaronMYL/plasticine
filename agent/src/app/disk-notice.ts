// 服务器磁盘不够（可用不到 1 GB）：一天提醒一次。以前记成一封「通知信」（站内信 source = plasticine）；《优化清单》
// 第 12 条（他 11-06 定）起改成主线上的一条系统消息 + 系统通知（attention/notices.ts），旧的通知信留着不动。

import { statfsSync } from 'node:fs';
import type { NoticePoster } from '../attention/index.ts';

// 低于这个就提醒：数据库、备份和安装包一次升级要用的空间留够。
const LOW_DISK_BYTES = 1024 ** 3;

export function scanDiskNotice(options: { notices: NoticePoster; directory: string; now: () => Date;
  freeBytes?: () => number }): void {
  let free: number;
  if (options.freeBytes === undefined) {
    const disk = statfsSync(options.directory);
    free = disk.bavail * disk.bsize;
  } else {
    free = options.freeBytes();
  }
  if (free >= LOW_DISK_BYTES) return;
  const day = options.now().toISOString().slice(0, 10);
  options.notices.post({ key: `disk-low:${day}`, brief: '服务器磁盘空间不足',
    text: `服务器磁盘空间不足：当前可用 ${(free / LOW_DISK_BYTES).toFixed(2)} GB，请在文件页核对需要清理的内容。`,
    url: '/#/settings/system' });
}
