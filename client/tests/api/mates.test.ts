import { Value } from 'typebox/value';
import { LegacyChatProposalSchema } from '../../src/api/shared.ts';
import { expect, it } from 'vitest';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { createRequestId } from '../../src/api/request-id.ts';
import type { MateDraft } from '../../src/api/shared.ts';

const draft: MateDraft = { name: '资料研究员', avatar: '研', hue: 'sky', role: '整理资料与来源', soul: '', purpose: null };
function setup() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0 });
  fake.control.session.signInForDevelopment('测试机');
  return fake;
}
it('队友创建幂等、保留独立对话，群组限制2至6位并保留版本保护', async () => {
  const { api, control } = setup();
  const input = { requestId: createRequestId(), ...draft };
  const first = await api.mates.create(input);
  expect((await api.mates.create(input)).id).toBe(first.id);
  const second = await api.mates.create({ requestId: createRequestId(), ...draft, name: '编辑队友' });
  expect(first.lineId).not.toBe(second.lineId);
  expect(control.lines.find(first.lineId)?.mateId).toBe(first.id);
  await expect(api.mateGroups.create({ requestId: createRequestId(), name: '资料小组', mateIds: [first.id] }))
    .rejects.toMatchObject({ status: 400 });
  const group = await api.mateGroups.create({ requestId: createRequestId(), name: '资料小组',
    mateIds: [first.id, second.id] });
  expect(control.lines.find(group.lineId)?.mateGroupId).toBe(group.id);
  const next = await api.mates.update(first.id, { requestId: createRequestId(), version: first.version,
    role: '核对资料来源' });
  expect(next.lineId).toBe(first.lineId);
  await expect(api.mates.update(first.id, { requestId: createRequestId(), version: first.version, name: '新的名字' }))
    .rejects.toMatchObject({ status: 409 });
});

it('整理旧对话先给建议，只有确认转换才改变队友身份，并保留原消息', async () => {
  const { api, control } = setup();
  const { line } = await api.lines.openSide({ requestId: createRequestId(), title: '资料研究' });
  control.lines.record(line.id, { role: 'user', text: '继续核对资料', origin: { kind: 'user', userText: '继续核对资料' },
    thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null, summary: null,
    stopReason: null, childLineId: null, attachments: [], widgets: [], createdAt: new Date().toISOString() });
  const proposal = await api.mates.prepareLegacy(line.id);
  expect(Value.Check(LegacyChatProposalSchema, proposal)).toBe(true);
  expect((await api.mates.list()).mates).toHaveLength(0);
  expect((await api.mates.list()).legacyChats).toHaveLength(1);
  const result = await api.mates.convertLegacy({ requestId: createRequestId(), lineId: line.id,
    action: 'mate', draft: proposal.draft });
  expect(result.mate?.lineId).toBe(line.id);
  expect(control.lines.messagesOf(line.id)[0]?.text).toBe('继续核对资料');
  expect((await api.mates.list()).legacyChats).toEqual([]);
});
