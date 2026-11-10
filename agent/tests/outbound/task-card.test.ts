import assert from 'node:assert/strict';
import { test } from 'node:test';
import { taskCardTool } from '../../src/app/task-card-tool.ts';
import { OutboundAuthorizer, settleNetworkOutbound } from '../../src/outbound/index.ts';
import { MAIN_LINE_ID } from '../../src/state/index.ts';
import { argsDigest } from '../../src/system/index.ts';
import { startTestApp } from '../app/helpers.ts';

test('真实任务卡声明账号对象和原文，进入发件箱后等真实回执再记已发送', async () => {
  const app = await startTestApp([], { startTasks: false });
  try {
    const state = app.state;
    const at = app.clock.now().toISOString();
    state.networkIdentity.create({ accountId: 'account-fixture', handle: 'fixture', displayName: '测试账号',
      relayUrl: 'https://relay.example.com', signingPublicKey: 'fixture-public', signingPrivateKey: 'fixture-private',
      encryptionPublicKey: 'fixture-encryption-public', encryptionPrivateKey: 'fixture-encryption-private',
      joinedAt: at });
    const contact = state.contacts.create({ accountId: 'recipient-fixture', handle: 'recipient',
      displayName: '测试联系人', signingKey: 'fixture-signing', encryptionKey: 'fixture-encryption',
      state: 'active', lastAt: at });
    const tool = taskCardTool(state, app.app.deps.network);
    const args = { to: 'recipient', title: '测试任务', goal: '返回测试结果' };
    const spec = tool.outbound!(args)!;
    assert.equal(spec.account, 'account-fixture');
    assert.deepEqual(spec.recipients, [contact.id]);
    assert.equal(spec.category, 'task_card');
    const { content, ...range } = spec;
    const grant = state.outboundGrants.create({ actor: MAIN_LINE_ID, ...range, fixedTexts: [content],
      recipientMode: 'list', scope: { kind: 'once' }, expiresAt: null,
    }, { deviceId: 'fixture-device', confirmedAt: at });
    const authorizer = new OutboundAuthorizer(state, app.clock.now);
    const claim = authorizer.claim({ actorId: MAIN_LINE_ID, lineId: MAIN_LINE_ID, projectId: null, scheduleId: null },
      { toolCallId: 'fixture-call', toolName: tool.name, argsDigest: argsDigest(args) }, spec);
    assert.ok(claim);
    const result = await tool.create({ lineId: MAIN_LINE_ID, kind: 'main', projectId: null })
      .execute('fixture-call', args, new AbortController().signal);
    const receipt = tool.outboundResult!(result, false);
    assert.equal(receipt.status, 'queued');
    authorizer.finish(MAIN_LINE_ID, 'fixture-call', receipt);
    const taskId = receipt.sourceRef!.slice('network-task:'.length);
    const message = state.contactMessages.forTask(taskId)[0]!;
    assert.equal(message.status, 'sending');
    assert.equal(state.outboundLog.list(grant.id)[0]?.status, 'queued');
    state.contactMessages.update(message.id, message.version, { status: 'sent' });
    settleNetworkOutbound(state, taskId);
    assert.equal(state.outboundLog.list(grant.id)[0]?.status, 'sent');
  } finally { await app.close(); }
});
