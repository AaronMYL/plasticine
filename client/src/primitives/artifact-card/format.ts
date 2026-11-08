import { formatClock } from '../message/states.ts';

/** 附件和备份共用的体积显示，原始字节数仍留在数据里。 */
export function fileSize(bytes: number): string {
  const kilo = 1024;
  if (bytes < kilo) {
    return `${bytes} B`;
  }
  if (bytes < kilo * kilo) {
    return `${(bytes / kilo).toFixed(1)} KiB`;
  }
  return `${(bytes / (kilo * kilo)).toFixed(1)} MiB`;
}
/** 付款摘要里的存储时间仍是 ISO；阅读时与对话使用同一个格式函数。 */
export function attachmentSummary(text: string, timeZone = 'Asia/Shanghai'): string {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g, (iso) =>
    formatClock(iso, true, timeZone),
  );
}
