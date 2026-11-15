// 提交信息的规矩（plasticine-code「每次改动的流程」）：第一行是一句话、不超过 72 个字，下面分点写；不写共同作者行。
// 只查这条规矩定下来（2026-11-15）以后的提交。

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** 定规矩之前的最后一个提交：它和它以前的不查。 */
const BASE = '44c7e15';
export const SUBJECT_MAX = 72;

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const hasBase = git('cat-file', '-e', `${BASE}^{commit}`) !== null;
const options = { skip: hasBase ? false : '这里没有 git 历史（比如解压出来的源码包）' };
const FORMAT = '--format=%h%x09%s%x09%(trailers:key=Co-Authored-By,valueonly,separator=%x20)';

test('提交信息第一行不超过 72 个字，不写共同作者行', options, () => {
  const log = git('log', `${BASE}..HEAD`, FORMAT) ?? '';
  const long: string[] = [];
  const coAuthored: string[] = [];
  for (const row of log.split('\n').filter((line) => line !== '')) {
    const [hash = '', subject = '', trailer = ''] = row.split('\t');
    if (Array.from(subject).length > SUBJECT_MAX) {
      long.push(`${hash} ${subject}`);
    }
    if (trailer.trim() !== '') {
      coAuthored.push(hash);
    }
  }
  assert.deepEqual(long, [], '第一行写成一句话，细节放到下面分点写');
  assert.deepEqual(coAuthored, [], '提交里不写共同作者行');
});
