import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { macSwapScript, windowsInstallScript } from '../src/updates/update-scripts.ts';
import { tempDir } from './helpers.ts';

function layout(dir: string, healthy: boolean) {
  const app = join(dir, 'Applications', 'Plasticine.app');
  const incoming = join(dir, 'staged', 'Plasticine.app');
  mkdirSync(join(app, 'Contents'), { recursive: true });
  mkdirSync(join(incoming, 'Contents'), { recursive: true });
  writeFileSync(join(app, 'Contents', 'version'), 'old');
  writeFileSync(join(incoming, 'Contents', 'version'), 'new');
  const marker = join(dir, 'started-2026.1108.000000');
  const open = join(dir, 'open.sh');
  writeFileSync(open, healthy ? `#!/bin/sh\necho >> ${join(dir, 'opened')}\ntouch '${marker}'\n`
    : `#!/bin/sh\necho >> ${join(dir, 'opened')}\n`);
  chmodSync(open, 0o755);
  const script = macSwapScript({ pid: 999_999, app, incoming, previous: join(dir, 'previous', 'Plasticine.app'),
    marker, rolledBack: join(dir, 'rolled-back.json'), version: '2026.1108.000000', open, lsregister: 'true',
    waitSeconds: 1 });
  const file = join(dir, 'swap.sh');
  writeFileSync(file, script);
  return { app, file, dir };
}

test('Mac swaps only Contents keeping Plasticine.app dir, promotes new version, archives previous', (t) => {
  const { app, file, dir } = layout(tempDir(t), true);
  const folder = statSync(app).ino;
  execFileSync('/bin/sh', [file]);
  assert.equal(readFileSync(join(app, 'Contents', 'version'), 'utf8'), 'new');
  assert.equal(statSync(app).ino, folder);
  assert.equal(readFileSync(join(dir, 'previous', 'Plasticine.app', 'Contents', 'version'), 'utf8'), 'old');
  assert.equal(existsSync(join(dir, 'rolled-back.json')), false);
});

test('Mac rolls back to previous, records bad version, and relaunches if new version misses marker', (t) => {
  const { app, file, dir } = layout(tempDir(t), false);
  assert.throws(() => execFileSync('/bin/sh', [file]), (error: { status?: number }) => error.status === 2);
  assert.equal(readFileSync(join(app, 'Contents', 'version'), 'utf8'), 'old');
  assert.equal(JSON.parse(readFileSync(join(dir, 'rolled-back.json'), 'utf8')).failed, '2026.1108.000000');
  assert.equal(readFileSync(join(dir, 'opened'), 'utf8').split('\n').length - 1, 2);
});

test('Windows silently installs new version, rolls back on boot failure, or logs failure if none', () => {
  const script = windowsInstallScript({ pid: 12, setup: 'C:\\u\\new.exe', previousSetup: "C:\\u\\o'ld.exe",
    marker: 'C:\\m', rolledBack: 'C:\\r.json', version: '2026.1108.000000', exeName: 'Plasticine.exe',
    installed: 'C:\\p\\Plasticine.exe', log: 'C:\\u\\install.log', waitSeconds: 90 });
  assert.match(script, /\$Installed = 'C:\\p\\Plasticine\.exe'/);
  assert.match(script, /Start-Process -FilePath \$Installed/);
  assert.match(script, /Get-Process -Id 12 .*ProcessName -eq \$ExeName .*Stop-Process -Force/);
  assert.match(script, /Start-Transcript -LiteralPath 'C:\\u\\install\.log'/);
  assert.match(script, /'\/S','--updated','--force-run'/);
  assert.match(script, /\$Previous = 'C:\\u\\o''ld\.exe'/);
  assert.match(script, /Get-Process -Name \$ExeName/);
  assert.match(script, /\$ExeName = 'Plasticine'/);
  const first = windowsInstallScript({ pid: 12, setup: 'a', previousSetup: null, marker: 'm', rolledBack: 'r',
    version: 'v', exeName: 'Plasticine.exe', installed: 'p', log: 'l', waitSeconds: 90 });
  assert.match(first, /\$Previous = \$null/);
});
