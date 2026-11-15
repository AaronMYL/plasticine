
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
