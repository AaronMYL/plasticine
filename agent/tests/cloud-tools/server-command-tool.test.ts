import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ServerCommands } from '../../src/cloud-tools/index.ts';
import { createServerCommandTools } from '../../src/cloud-tools/server-command-tool.ts';
import { ToolRegistry } from '../../src/tools/registry.ts';
import { toolContext } from '../tools/helpers.ts';
import { tempDirectory } from '../state/helpers.ts';

test('server command returns real exit code/output; read-only tool for verifier, exec omitted', async () => {
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
