export function soulOf(name: string): string {
  return /[A-Za-z0-9]$/u.test(name) ? `${name} 的 Soul` : `${name}的 Soul`;
}

export function intoSoul(name: string): string {
  return `进${/^[A-Za-z0-9]/u.test(name) ? ' ' : ''}${soulOf(name)}`;
}
