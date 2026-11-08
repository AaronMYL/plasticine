export function browserAddress(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) { return value; }
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(value)
    || /^localhost(?::\d+)?(?:[/?#]\S*)?$/.test(value)) { return `https://${value}`; }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
