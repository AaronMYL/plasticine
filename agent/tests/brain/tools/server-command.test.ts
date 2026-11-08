import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ServerCommands } from '../../../src/cloud-tools/index.ts';
import { createServerCommandTools } from '../../../src/brain/tools/server-command.ts';
import { ToolRegistry } from '../../../src/brain/tools/registry.ts';
import { toolContext } from '../helpers.ts';
import { tempDirectory } from '../../state/helpers.ts';

test('服务器命令照实回退出码和输出，只读工具给验收角色、执行工具不给', async () => {
  const dir = await tempDirectory();
  try {
    const service = new ServerCommands({ stateDirectory: dir.directory, cwd: dir.directory });
    const registry = new ToolRegistry();
    const tools = createServerCommandTools(service);
    tools.forEach((tool) => registry.register(tool));
    const exec = tools.find((tool) => tool.name === 'server_exec')!;
    const result = JSON.parse(await exec.execute({ script: 'printf x >> once; printf 实际结果; exit 9' },
      toolContext('exec')));
    assert.equal(result.exitCode, 9);
    assert.equal(result.succeeded, false);
    assert.equal(result.stdout.text, '实际结果');
    assert.equal(readFileSync(join(dir.directory, 'once'), 'utf8'), 'x');
    assert.equal(registry.isOffered('server_exec', 'verifier'), false);
    assert.equal(registry.isOffered('server_command_read', 'verifier'), true);
  } finally { await dir.cleanup(); }
});
