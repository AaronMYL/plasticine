import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CJK_PATTERN } from '../../../scripts/lint-statements.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LEGACY_TIP = '13cca94';
export const SUBJECT_MAX = 72;

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const hasGit = git('rev-parse', '--git-dir') !== null;
const hasLegacyTip = hasGit && git('cat-file', '-e', `${LEGACY_TIP}^{commit}`) !== null;
const options = { skip: hasGit ? false : 'git metadata unavailable in unpacked archive' };
const FORMAT = '--format=%h%x1f%s%x1f%b%x1f%(trailers:key=Co-Authored-By,valueonly,separator=%x20)%x1e';

test('enforces English-only commit messages under 72 characters without Co-Authored-By trailers', options, () => {
  const range = hasLegacyTip ? `${LEGACY_TIP}..HEAD` : 'HEAD';
  const log = git('log', '--no-merges', range, FORMAT) ?? '';
  const long: string[] = [];
  const coAuthored: string[] = [];
  const nonEnglish: string[] = [];
  for (const entry of log.split('\x1e').map((chunk) => chunk.trim()).filter((chunk) => chunk !== '')) {
    const [hash = '', subject = '', body = '', trailer = ''] = entry.split('\x1f');
    if (Array.from(subject).length > SUBJECT_MAX || subject.trim() === '') {
      long.push(`${hash} ${subject}`);
    }
    if (trailer.trim() !== '') {
      coAuthored.push(hash);
    }
    if (CJK_PATTERN.test(subject) || CJK_PATTERN.test(body)) {
      nonEnglish.push(`${hash} ${subject}`);
    }
  }
  assert.deepEqual(long, [], 'Commit subject must be a concise line <= 72 characters');
  assert.deepEqual(coAuthored, [], 'Commit messages must not include Co-Authored-By trailers');
  assert.deepEqual(nonEnglish, [], 'Commit messages must be written in English without Chinese characters');
});
