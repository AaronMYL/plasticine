// 第 12 批：人和人的聊天里加表情、回某一句；联系人改备注、绑记忆人物页（Plasticine 先问）、删除和恢复；
// 绑了联系人的人物页不拿去对外答。开源版不带中继：发出去的信只看发件箱里的那一行。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { foldReactions } from '../../src/network/contact-edits.ts';
import { gatherMaterials } from '../../src/network/visibility.ts';
import { generateIdentityKeys } from '../../src/network/index.ts';
import type { ContactMessage } from '../../shared/state.ts';
import { call, json, pair, startTestApp, type TestApp } from '../app/helpers.ts';
import { contacts, post, thread, type Body } from './helpers.ts';

const opened: TestApp[] = [];

afterEach(async () => {
  for (const started of opened.splice(0)) await started.close();
});

async function joined(): Promise<{ t: TestApp; cookie: string; contactId: string; incomingId: string }> {
  const t = await startTestApp([], { startTasks: false, network: { relayUrl: 'http://127.0.0.1:9', autoSync: false } });
  opened.push(t);
  const me = generateIdentityKeys();
  const at = t.clock.now().toISOString();
  t.state.networkIdentity.create({ accountId: 'acct-me-0001', handle: 'alex', displayName: 'Alex',
    relayUrl: 'http://127.0.0.1:9', signingPublicKey: me.signing.publicKey, signingPrivateKey: me.signing.privateKey,
    encryptionPublicKey: me.encryption.publicKey, encryptionPrivateKey: me.encryption.privateKey, joinedAt: at });
  const them = generateIdentityKeys();
  const contact = t.state.contacts.create({ accountId: 'acct-sam-0001', handle: 'samwise', displayName: 'samwise',
    signingKey: them.signing.publicKey, encryptionKey: them.encryption.publicKey, relation: 'friend',
    state: 'active', lastAt: at });
  const incoming = t.state.contactMessages.create({ contactId: contact.id, direction: 'in', author: 'them',
    kind: 'text', text: '我下个月搬家', payload: { text: '我下个月搬家', replyTo: null }, sentAt: at, status: 'sent',
    envelopeId: 'env-incoming-0001' });
  return { t, cookie: await pair(t), contactId: contact.id, incomingId: incoming.id };
}

function messageOf(items: Body[], id: string): Body {
  const item = items.find((entry) => (entry['message'] as Body | undefined)?.['id'] === id);
  assert.ok(item !== undefined, `聊天里有 ${id}`);
  return item['message'] as Body;
}

test('加表情：发件箱里一封 reaction（认对方那封信的信封 id），聊天里那句带着我的表情；对方也加了就是两个', async () => {
  const { t, cookie, contactId, incomingId } = await joined();
  await post(t, cookie, `/v2/contacts/${contactId}/messages/${incomingId}/reaction`,
    { requestId: 'react-req-0001', emoji: '👍', on: true });
  const sent = t.state.contactMessages.reactions(contactId);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.payload, { messageId: 'env-incoming-0001', emoji: '👍', on: true });
  t.state.contactMessages.create({ contactId, direction: 'in', author: 'them', kind: 'reaction', text: '',
    payload: { messageId: 'env-incoming-0001', emoji: '👍', on: true }, sentAt: t.clock.now().toISOString(),
    status: 'sent', envelopeId: 'env-react-in-0001' });
  const view = messageOf(await thread(t, cookie, contactId), incomingId);
  assert.deepEqual(view['reactions'], [{ emoji: '👍', mine: true, count: 2 }]);
  const listed = (await contacts(t, cookie))['contacts'] as Body[];
  assert.equal(listed.find((row) => row['id'] === contactId)?.['unread'], 1, '表情不算未读');
});

test('表情折叠：每人每种表情最后一次说了算', () => {
  const row = (direction: 'in' | 'out', on: boolean, contactId = 'c1'): ContactMessage =>
    ({ direction, contactId, payload: { messageId: 'm1', emoji: '😂', on } }) as unknown as ContactMessage;
  const folded = foldReactions([row('out', true), row('in', true), row('out', false), row('in', true, 'c2')]);
  assert.deepEqual(folded.get('m1'), [{ emoji: '😂', mine: false, count: 2 }]);
});

test('回某一句：发出去的 text 带着那一句的信封 id，聊天里那句写「回的是谁的哪句」', async () => {
  const { t, cookie, contactId, incomingId } = await joined();
  const sent = await post(t, cookie, `/v2/contacts/${contactId}/messages`,
    { requestId: 'send-req-0001', text: '要帮忙搬吗', replyToId: incomingId });
  const id = (sent['message'] as Body)['id'] as string;
  assert.equal(t.state.contactMessages.require(id).payload?.['replyTo'], 'env-incoming-0001');
  const view = messageOf(await thread(t, cookie, contactId), id);
  assert.deepEqual(view['replyTo'], { author: 'samwise', text: '我下个月搬家' });
});

test('改备注：列表和聊天里都用备注；去掉备注回到他自己的名字', async () => {
  const { t, cookie, contactId } = await joined();
  const version = t.state.contacts.require(contactId).version;
  const named = await post(t, cookie, `/v2/contacts/${contactId}/alias`,
    { requestId: 'alias-req-0001', version, alias: '山姆' });
  assert.equal((named['contact'] as Body)['name'], '山姆');
  const cleared = await post(t, cookie, `/v2/contacts/${contactId}/alias`,
    { requestId: 'alias-req-0002', version: version + 1, alias: null });
  assert.equal((cleared['contact'] as Body)['name'], 'samwise');
});

test('人物页：名字像就先问；答「不是」不再问；绑上后资料栏写那一页和谁说的；也能新建一页再绑', async () => {
  const { t, cookie, contactId } = await joined();
  const doc = t.state.memoryDocs.docs.create({ kind: 'person', title: '山姆', summary: '朋友，@samwise',
    createdBy: 'user' });
  const detail = async (): Promise<Body> =>
    json(await call(t, 'GET', `/v2/contacts/${contactId}`, { cookie }))['memory'] as Body;
  assert.deepEqual((await detail())['suggest'], { id: doc.id, title: '山姆' });
  const version = (): number => t.state.contacts.require(contactId).version;
  await post(t, cookie, `/v2/contacts/${contactId}/person`, { requestId: 'person-req-0001', version: version(),
    dismiss: true });
  assert.equal((await detail())['suggest'], null);
  await post(t, cookie, `/v2/contacts/${contactId}/person`, { requestId: 'person-req-0002', version: version(),
    docId: doc.id });
  t.state.memoryDocs.lines.add({ docId: doc.id, text: '山姆下个月搬家', basis: 'contact_stated',
    anchors: [{ kind: 'contact_message', ref: 'msg-any-0001' }], writtenBy: 'brain' });
  t.clock.advance(1000);
  t.state.memoryDocs.lines.add({ docId: doc.id, text: '山姆喜欢爬山', basis: 'stated',
    anchors: [{ kind: 'message', ref: 'msg-any-0002' }], writtenBy: 'brain' });
  const memory = await detail();
  assert.deepEqual(memory['doc'], { id: doc.id, title: '山姆' });
  const tags = new Map((memory['lines'] as Body[]).map((line) => [line['text'], line['by']]));
  assert.equal(tags.get('山姆下个月搬家'), '山姆说的');
  assert.equal(tags.get('山姆喜欢爬山'), '你说的');
  await post(t, cookie, `/v2/contacts/${contactId}/person`, { requestId: 'person-req-0003', version: version(),
    create: '新的一页' });
  assert.equal(((await detail())['doc'] as Body)['title'], '新的一页');
});

test('删除联系人：列表里没了、关系回陌生人，记录还在；恢复回到列表', async () => {
  const { t, cookie, contactId } = await joined();
  await post(t, cookie, `/v2/contacts/${contactId}/remove`, { requestId: 'remove-req-0001' });
  const listed = await contacts(t, cookie);
  const after = listed['contacts'] as Body[];
  assert.equal(after.some((row) => row['id'] === contactId), false);
  assert.deepEqual((listed['removed'] as Body[]).map((row) => row['id']), [contactId], '在「最近删除」里');
  assert.equal(t.state.contacts.require(contactId).relation, 'stranger');
  assert.equal(t.state.contactMessages.page(contactId, undefined, 10).length, 1);
  await post(t, cookie, `/v2/contacts/${contactId}/restore`, { requestId: 'restore-req-0001' });
  const restored = await contacts(t, cookie);
  assert.equal((restored['contacts'] as Body[]).some((row) => row['id'] === contactId), true);
  assert.deepEqual(restored['removed'], []);
});

test('绑了联系人的人物页不管标成哪一档都不拿去对外答', async () => {
  const { t, contactId } = await joined();
  const doc = t.state.memoryDocs.docs.create({ kind: 'person', title: '山姆', summary: '朋友', createdBy: 'user' });
  t.state.memoryDocs.lines.add({ docId: doc.id, text: '山姆住在河边', basis: 'stated',
    anchors: [{ kind: 'system', ref: 'seed' }], writtenBy: 'user' });
  t.state.visibilityMarks.put('memory_topic', doc.id, 0, { tier: 'public', proposed: null, confirmed: true });
  assert.equal(gatherMaterials(t.state, ['public']).some((entry) => entry.id === doc.id), true);
  const contact = t.state.contacts.require(contactId);
  t.state.contacts.update(contactId, contact.version, { personDocId: doc.id });
  assert.equal(gatherMaterials(t.state, ['public']).some((entry) => entry.id === doc.id), false);
});

test('联系人说的关于自己的事：绑了人物页才排整理，写成那一页的一行（依据 contact_stated，链回那一句）', async () => {
  const { t, contactId, incomingId } = await joined();
  const { contactMemorySources, runContactJob } = await import('../../src/brain/contact-memory.ts');
  assert.deepEqual(contactMemorySources(t.state, t.clock.now()), []);
  const doc = t.state.memoryDocs.docs.create({ kind: 'person', title: '山姆', summary: '朋友', createdBy: 'user' });
  t.state.contacts.update(contactId, t.state.contacts.require(contactId).version, { personDocId: doc.id });
  const sources = contactMemorySources(t.state, t.clock.now());
  assert.deepEqual(sources.map((source) => [source.message.id, source.docId]), [[incomingId, doc.id]]);
  const { job } = t.state.memoryCuration.jobs.enqueue({ key: `contact:${incomingId}`, kind: 'contact', runId: null,
    chatId: null, replyId: null, docId: doc.id, sourceIds: [incomingId] });
  const model = { models: { ask: async () => ({ text: '{"lines":["山姆下个月搬家"]}' }) } };
  const done = await runContactJob(t.state, model as never, job, new AbortController().signal);
  assert.equal(done.result.applied, 1);
  const [line] = t.state.memoryDocs.lines.live(doc.id);
  assert.equal(line?.basis, 'contact_stated');
  assert.deepEqual(line?.anchors, [{ kind: 'contact_message', ref: incomingId }]);
  assert.deepEqual(contactMemorySources(t.state, t.clock.now()), [], '排过的不再排');
});

// 11-12 全量优化第 5 条：确认卡在聊天里答。草稿改过再发，发出去的是改过的那一版；没改就是草稿原样；「不回」什么都不发。
async function replyAsk(t: TestApp, contactId: string, questionId: string): Promise<string> {
  return t.state.asks.create({
    kind: 'confirm', purpose: 'network_reply', channel: 'popup', question: 'samwise 问你的 Plasticine：周五能交吗？',
    options: [{ id: 'send', label: '这样回', description: null, recommended: true },
      { id: 'self', label: '我自己回', description: null, recommended: false },
      { id: 'none', label: '不回', description: null, recommended: false }],
    context: { contactId, groupId: null, questionId, exchangeId: questionId, draft: '周五能交。', askerIsAi: false,
      materials: [] },
  }).id;
}

function aiLines(t: TestApp, contactId: string): string[] {
  return t.state.contactMessages.recent(contactId, 50)
    .filter((message: ContactMessage) => message.direction === 'out' && message.author === 'my_ai')
    .map((message: ContactMessage) => message.text);
}

test('确认卡：改过草稿再发，发的是改过的那一版；没改发草稿；不回什么都不发', async () => {
  const { t, cookie, contactId } = await joined();
  const edited = await replyAsk(t, contactId, 'q-edited');
  await post(t, cookie, `/v2/asks/${edited}/answer`, { optionId: 'send', text: '  周六上午交。 ' });
  assert.deepEqual(aiLines(t, contactId), ['周六上午交。']);
  const plain = await replyAsk(t, contactId, 'q-plain');
  await post(t, cookie, `/v2/asks/${plain}/answer`, { optionId: 'send' });
  assert.deepEqual(aiLines(t, contactId).sort(), ['周五能交。', '周六上午交。']);
  const silent = await replyAsk(t, contactId, 'q-silent');
  await post(t, cookie, `/v2/asks/${silent}/answer`, { optionId: 'none' });
  assert.equal(aiLines(t, contactId).length, 2);
  // 说出去的那一句记进「说过什么」，记的也是改过的那一版。
  assert.ok(t.state.saidLog.recent(contactId, 10).some((row) => row.text === '周六上午交。'));
});
