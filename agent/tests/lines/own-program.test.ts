// Plasticine 改自己的程序、重启自己的服务要先问他（11-17「收紧」）。先测认脚本的那一层，再测服务器命令工具真的出卡。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { serverCommandTool } from '../../src/lines/index.ts';
import { ownProgramTouch } from '../../src/lines/own-program.ts';
import { defineTool } from '../../src/tools/index.ts';
import { startKernel, until, type Harness } from './helpers.ts';

const open: Harness[] = [];

afterEach(async () => {
  for (const item of open.splice(0)) {
    await item.close();
  }
});

test('11-17 那次的两步都认得出：把改过的文件挪进程序目录、起临时单元重启服务', () => {
  assert.equal(ownProgramTouch(
    'sudo mv /opt/plasticine/current/agent/src/tasks/send-permit.ts.new '
    + '/opt/plasticine/current/agent/src/tasks/send-permit.ts'), 'program');
  assert.equal(ownProgramTouch(
    'sudo systemd-run --unit=plasticine-paste-fix-restart --on-active=5 systemctl restart plasticine-app'),
  'service');
});

test('改程序目录的各种写法：拷进去、改权限、原地改、重定向、解包、换 current、脚本语言直接写', () => {
  const scripts = [
    'sudo cp /tmp/page-send.ts /opt/plasticine/current/agent/src/devices/page-send.ts',
    'sudo install -o root -m 644 /tmp/a.ts /opt/plasticine/versions/2026.1117.080512/agent/src/a.ts',
    'echo "x" | sudo tee /opt/plasticine/current/agent/src/a.ts',
    "sudo sed -i 's/a/b/' /opt/plasticine/current/agent/src/a.ts",
    'sudo sh -c "cat /tmp/a.ts > /opt/plasticine/current/agent/src/a.ts"',
    'sudo tar -xzf /tmp/new.tgz -C /opt/plasticine/versions/next',
    'sudo ln -sfn /tmp/patched /opt/plasticine/current',
    'sudo rm -rf /opt/plasticine/versions/2026.1116.214825',
    'sudo chown -R plasticine /opt/plasticine/current',
    'sudo chattr -i /opt/plasticine/current/agent/src/a.ts',
    "cd /opt/plasticine/current && sudo sed -i 's/a/b/' agent/src/a.ts",
    'cd /opt/plasticine/current\nsudo git checkout -- agent/src/a.ts',
    "python3 - <<'PY'\nopen('/opt/plasticine/current/agent/src/a.ts', 'w').write('x')\nPY",
  ];
  for (const script of scripts) {
    assert.equal(ownProgramTouch(script), 'program', script);
  }
  assert.equal(ownProgramTouch('sudo git stash', '/opt/plasticine/current'), 'program', '工作目录在程序目录里');
});

test('重启、停掉自己的服务：腾讯云上的名字、安装包的名字、自动更新；别的服务不算', () => {
  for (const script of ['sudo systemctl restart plasticine-app', 'sudo -n systemctl stop plasticine-app.service',
    'systemctl --no-block restart plasticine', 'sudo systemctl disable --now plasticine-update.timer',
    'sudo service plasticine restart', 'sudo pkill -f plasticine', 'sudo systemctl kill plasticine-app']) {
    assert.equal(ownProgramTouch(script), 'service', script);
  }
  for (const script of ['sudo systemctl restart caddy', 'sudo systemctl restart plasticine-ops-watch',
    'systemctl status plasticine-app', 'systemctl is-active plasticine-app', 'systemctl show plasticine-app -p MainPID',
    'sudo journalctl -u plasticine-app --since -1h | tail -50']) {
    assert.equal(ownProgramTouch(script), null, script);
  }
});

test('只查、只读、往外拷、跑维护入口都不问；程序目录以外的照旧不问', () => {
  const scripts = [
    'cat /opt/plasticine/current/agent/src/tasks/send-permit.ts | head -40',
    'ls -la /opt/plasticine/versions; readlink /opt/plasticine/current',
    'grep -rn "unverifiedPaste" /opt/plasticine/current/agent/src | head',
    'cp /opt/plasticine/current/agent/src/a.ts /tmp/a.ts',
    'git -C /opt/plasticine/current log --oneline | head -3',
    'sudo -n -u plasticine /usr/local/bin/node /opt/plasticine/current/scripts/maint.ts db.read "SELECT 1"',
    'stat /opt/plasticine/current; rm -f /tmp/a.ts.new',
    'rm -rf /home/plasticine/state/agent/sandbox/old && mkdir -p /tmp/work',
    "python3 - <<'PY'\nopen('/tmp/out.txt', 'w').write('x')\nPY",
    'sudo apt-get install -y ripgrep',
  ];
  for (const script of scripts) {
    assert.equal(ownProgramTouch(script), null, script);
  }
});

function serverTool(ran: string[]) {
  const local = defineTool({
    name: 'server_exec', label: '服务器命令', description: '本机跑脚本', replay: 'safe', effect: 'read',
    permission: 'auto', roles: ['conversation', 'worker'], timeoutMs: 5_000,
    parameters: Type.Object({ script: Type.String(), cwd: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Integer()) }, { additionalProperties: false }),
    execute: async (args) => {
      ran.push(args.script);
      return '跑完了';
    },
  });
  return serverCommandTool({ local, remote: undefined }, { dryRun: false, now: () => new Date() });
}

test('服务器命令：重启自己的服务先出卡，不同意就不跑；普通命令和写了 host 的不出卡', async () => {
  const ran: string[] = [];
  const tool = serverTool(ran);
  assert.equal(tool.hardLine({ script: 'uptime' }), null);
  assert.equal(tool.hardLine({ script: 'sudo systemctl restart plasticine-app', host: 'aliyun' }), null);
  assert.equal(tool.hardLine({ script: 'sudo systemctl restart plasticine-app' }), 'permission');
  assert.match(tool.consequence?.({ script: 'sudo systemctl restart plasticine-app' }) ?? '',
    /重启或停掉 Plasticine 自己的服务/);
  assert.match(tool.consequence?.({ script: 'sudo rm -rf /opt/plasticine/current' }) ?? '', /Plasticine 自己的程序/);

  const h = await startKernel({ tools: [tool] });
  open.push(h);
  h.respond([
    fauxAssistantMessage([fauxToolCall('server_command', { script: 'uptime' }, { id: 's1' })],
      { stopReason: 'toolUse' }),
    fauxAssistantMessage([fauxToolCall('server_command', { script: 'sudo systemctl restart plasticine-app' },
      { id: 's2' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('没重启。'),
  ]);
  h.kernel.send('main', { text: '看看服务器' });
  await until(() => h.kernel.view('main').status === 'waiting', '线在等他');
  assert.deepEqual(ran, ['uptime']);
  const ask = h.handle.state.asks.open()[0];
  assert.equal(ask?.basis, 'hard_line');
  assert.match(ask?.detail ?? '', /会重启或停掉 Plasticine 自己的服务/);
  assert.ok(ask !== undefined);
  h.desk.answer({ askId: ask.id, optionId: 'deny', answerer: { deviceId: 'device-1' } });
  await until(() => h.kernel.view('main').status === 'idle', '线接着跑完');
  assert.deepEqual(ran, ['uptime']);
});
