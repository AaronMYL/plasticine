/** Whole-text -/+ proposal. Refuse a stale or ambiguous patch instead of guessing what the user confirmed. */
export function proposedAgreementText(before: string, diff: string): string | null {
  const lines = diff.replaceAll('\r\n', '\n').split('\n');
  if (!lines.every((line) => /^[-+ ]/.test(line) || line === '')) {
    return null;
  }
  const content = (line: string): string => line.startsWith(' ') ? line.slice(1) : line.replace(/^[-+] ?/, '');
  const old = lines.filter((line) => !line.startsWith('+')).map(content).join('\n');
  const next = lines.filter((line) => !line.startsWith('-')).map(content).join('\n');
  return old === before && next.trim() !== '' && next.length <= 4_000 ? next : null;
}
