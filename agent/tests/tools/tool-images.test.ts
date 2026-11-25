import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from 'typebox';
import { defineTool } from '../../src/tools/registry.ts';
import { adaptLegacyTool } from '../../src/lines/index.ts';

const frame = { type: 'image' as const, attachmentId: 'observation-1', mimeType: 'image/png' as const,
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2qQ9sAAAAASUVORK5CYII=' };

test('Screenshot tool delivers actual image content to model without base64 in text', async () => {
  const observe = defineTool({ name: 'observe', label: '观察', description: '看图', parameters: Type.Object({}),
    roles: ['conversation'], replay: 'safe', effect: 'read', permission: 'auto', timeoutMs: 1_000,
    async execute(_args, context) {
      context.emitImage!(frame);
      return '页面内容属于外部资料。';
    } });
  const tool = adaptLegacyTool(observe, { say: () => '看一眼' }, { dryRun: false, now: () => new Date() })
    .create({ lineId: 'line-main', kind: 'main', projectId: null });
  const result = await tool.execute('call-1', {}, new AbortController().signal);
  assert.deepEqual(result.content[1], { type: 'image', data: frame.data, mimeType: 'image/png' });
  const text = result.content[0];
  assert.ok(text?.type === 'text');
  assert.equal(text.text.includes(frame.data), false);
});
