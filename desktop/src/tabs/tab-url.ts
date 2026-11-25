export function reportedUrl(current: string, requested: string): string | null {
  if (current.trim() !== '') {
    return current;
  }
  return requested.trim() === '' ? null : requested;
}
