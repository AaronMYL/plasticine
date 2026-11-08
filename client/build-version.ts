import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 导出归档不带 .git，由部署入口传入提交时间；本地从同一提交读取，避免构建时钟改变产物。 */
export function buildVersion(): { buildId: string; builtAt: string } {
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
  const buildId = process.env['PLASTICINE_BUILD_ID'] ?? git(['rev-parse', 'HEAD']);
  const commit = /^[a-f0-9]{40}$/.test(buildId) ? buildId : 'HEAD';
  const timestamp = process.env['PLASTICINE_BUILT_AT'] ?? git(['show', '-s', '--format=%cI', commit, '--']);
  const builtAt = new Date(timestamp).toISOString();
  return { buildId, builtAt };
}
