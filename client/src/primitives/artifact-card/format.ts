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
