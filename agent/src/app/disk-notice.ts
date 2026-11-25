import { statfsSync } from 'node:fs';
import type { NoticePoster } from '../attention/index.ts';

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
