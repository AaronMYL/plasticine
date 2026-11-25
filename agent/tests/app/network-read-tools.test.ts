import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { networkReadTools } from '../../src/app/network-read-tools.ts';
import type { StateService } from '../../src/state/index.ts';
import { memoryState } from '../tools/helpers.ts';

let state: StateService;

beforeEach(() => {
  state = memoryState();
});

afterEach(() => {
  state.close();
});

async function run(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const tool = networkReadTools(state).find((item) => item.name === name)!
    .create({ lineId: 'line-main', kind: 'main', projectId: null } as never);
  const result = await tool.execute('call-1', args);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

test('contact_list lists contacts with unread; message_read returns recent messages oldest-first', async () => {
  const contact = state.contacts.create({ accountId: 'acct-lin', handle: 'linyi', displayName: '林一',
    signingKey: 'sig', encryptionKey: 'enc', state: 'active', lastAt: '2026-11-16T10:00:00.000Z' });
  const said: [string, string][] = [['第一句', '2026-11-16T09:00:00.000Z'], ['第二句', '2026-11-16T10:00:00.000Z']];
  for (const [text, sentAt] of said) {
    state.contactMessages.create({ contactId: contact.id, direction: 'in', author: 'them', kind: 'text', text,
      payload: { text, replyTo: null }, sentAt, status: 'sent' });
  }
  const listed = await run('contact_list') as { contacts: { contactId: string; name: string; unread: number }[] };
  assert.deepEqual(listed.contacts.map((item) => [item.name, item.unread]), [['林一', 2]]);
  const read = await run('message_read', { contactId: contact.id }) as { untrustedMaterial: boolean;
    messages: { text: string; from: string }[] };
  assert.equal(read.untrustedMaterial, true);
  assert.deepEqual(read.messages.map((item) => [item.from, item.text]), [['对方', '第一句'], ['对方', '第二句']]);
  await assert.rejects(run('message_read', {}), /给一个/);
});

test('grant_list returns only active grants with target, recipient, quote, and usage count', async () => {
  state.outboundGrants.create({ actor: 'line-main', channel: 'web:zhipin.com', account: 'web:zhipin.com',
    recipientMode: 'all', recipients: [], category: 'message', fixedTexts: ['您好'],
    scope: { kind: 'always' }, expiresAt: null } as never, { deviceId: 'fixture-device',
    confirmedAt: '2026-11-16T10:00:00.000Z' });
  const listed = await run('grant_list') as { grants: { channel: string; fixedTexts: string[]; usedCount: number }[] };
  assert.equal(listed.grants.length, 1);
  assert.equal(listed.grants[0]?.channel, 'web:zhipin.com');
  assert.deepEqual(listed.grants[0]?.fixedTexts, ['您好']);
  assert.equal(listed.grants[0]?.usedCount, 0);
});
