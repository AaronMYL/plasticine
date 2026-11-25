export const LEGACY_PUBLIC_URLS: readonly string[] = ['https://203.0.113.10'];

export function publicPage(publicUrl: string, route: string): string {
  return `${publicUrl.replace(/\/$/, '')}/#/${route}`;
}
