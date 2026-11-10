import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messageTools } from '../../src/app/message-tools.ts';
import { OutboundAuthorizer, settleMessageOutbound } from '../../src/outbound/index.ts';
import { generateIdentityKeys } from '../../src/network/index.ts';
import { startTestApp } from '../app/helpers.ts';

test('消息工具声明真实账号、精确对象和附件范围；发件箱回执更新审计且重放不重复', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const state = app.state, keys = generateIdentityKeys(), other = generateIdentityKeys();
    state.networkIdentity.create({ accountId: 'acct-sender-fixture', handle: 'senderfixture', displayName: '测试发送方',
      relayUrl: 'https://relay.example.test', signingPublicKey: keys.signing.publicKey,
      signingPrivateKey: keys.signing.privateKey, encryptionPublicKey: keys.encryption.publicKey,
      encryptionPrivateKey: keys.encryption.privateKey, joinedAt: app.clock.now().toISOString() });
    const contact = state.contacts.create({ accountId: 'acct-target-fixture', handle: 'targetfixture',
      displayName: '测试接收方', signingKey: other.signing.publicKey, encryptionKey: other.encryption.publicKey,
      state: 'active', lastAt: app.clock.now().toISOString() });
    const tool = messageTools(state, app.app.deps.network).find((item) => item.name === 'message_send')!;
    const args = { contactId: contact.id, text: '测试消息', target: 'person' };
    const spec = tool.outbound!(args)!;
    assert.equal(spec.account, 'acct-sender-fixture');
    assert.deepEqual(spec.recipients, [contact.id]);
    const { content, ...range } = spec;
    const grant = state.outboundGrants.create({ actor: 'mate-fixture', ...range, fixedTexts: [content],
      recipientMode: 'list', scope: { kind: 'once' }, expiresAt: null },
    { deviceId: 'fixture-device', confirmedAt: app.clock.now().toISOString() });
    const auth = new OutboundAuthorizer(state, app.clock.now);
    const scope = { actorId: 'mate-fixture', lineId: 'line-fixture', projectId: null, scheduleId: null };
    assert.ok(auth.claim(scope, { toolCallId: 'call-fixture', toolName: tool.name, argsDigest: 'fixture' }, spec));
    const executor = tool.create({ lineId: scope.lineId, kind: 'background', projectId: null });
    const result = await executor.execute('call-fixture', args, new AbortController().signal);
    const receipt = tool.outboundResult!(result, false);
    assert.equal(receipt.status, 'queued');
    auth.finish(scope.lineId, 'call-fixture', receipt);
    const id = receipt.sourceRef!.slice('network-message:'.length);
    const message = state.contactMessages.require(id);
    state.contactMessages.update(id, message.version, { status: 'sent' });
    settleMessageOutbound(state, receipt.sourceRef!);
    assert.equal(state.outboundLog.list(grant.id)[0]?.status, 'sent');
    await executor.execute('call-fixture', args, new AbortController().signal);
    assert.equal(state.contactMessages.recent(contact.id, 10).length, 1);
    assert.equal(auth.matches(grant, { ...scope, actorId: 'line-main' }, spec), false);
    const second = state.contacts.create({ accountId: 'acct-second-fixture', handle: 'secondfixture',
      displayName: '测试接收方二', signingKey: other.signing.publicKey, encryptionKey: other.encryption.publicKey,
      state: 'active', lastAt: app.clock.now().toISOString() });
    const group = app.app.deps.network.createGroup({ name: '测试工作组', memberIds: [contact.id, second.id],
      requestId: 'create-group-fixture' });
    const groupTool = messageTools(state, app.app.deps.network).find((item) => item.name === 'message_group_send')!;
    const groupArgs = { groupId: group.id, text: '测试群消息' };
    const { content: groupContent, ...groupRange } = groupTool.outbound!(groupArgs)!;
    const groupGrant = state.outboundGrants.create({ actor: scope.actorId, ...groupRange,
      recipientMode: 'list', fixedTexts: [groupContent], scope: { kind: 'once' }, expiresAt: null },
    { deviceId: 'fixture-device', confirmedAt: app.clock.now().toISOString() });
    assert.ok(auth.claim(scope, { toolCallId: 'group-call', toolName: groupTool.name, argsDigest: 'group-fixture' },
      { ...groupRange, content: groupContent }));
    const groupResult = await groupTool.create({ lineId: scope.lineId, kind: 'background', projectId: null })
      .execute('group-call', groupArgs, new AbortController().signal);
    const groupReceipt = groupTool.outboundResult!(groupResult, false);
    auth.finish(scope.lineId, 'group-call', groupReceipt);
    const posted = state.groupMessages.get(groupReceipt.sourceRef!.slice('network-group-message:'.length))!;
    const recipients = state.contactMessages.forGroupMessage(group.id, posted.messageId);
    assert.equal(recipients.length, 2);
    state.contactMessages.update(recipients[0]!.id, recipients[0]!.version, { status: 'sent' });
    state.contactMessages.update(recipients[1]!.id, recipients[1]!.version,
      { status: 'failed', error: '第二位对象拒收。' });
    settleMessageOutbound(state, groupReceipt.sourceRef!);
    const partial = state.outboundLog.list(groupGrant.id)[0]!;
    assert.equal(partial.status, 'unknown');
    assert.match(partial.summary, /第二位对象拒收/);

  } finally { await app.close(); }
});
