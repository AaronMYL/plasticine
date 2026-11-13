// 群里 @ Plasticine（11-13 Aaron 用过以后提的）：一句同时 @ 好几个人的 Plasticine；我 @ 自己的、它拿不准时不往群里发，
// 出一张只有我看得到的确认卡。开源版不带中继：发出去的只看本机记下的那几行。

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { generateIdentityKeys } from '../../src/network/index.ts';
import { sealedPrompt, settleAction, type Question } from '../../src/network/responder.ts';
import type { ProxyAnswer } from '../../shared/proxy-answer.ts';
import { call, json, pair, startTestApp, type TestApp } from '../app/helpers.ts';
import { post, type Body } from './helpers.ts';

const opened: TestApp[] = [];
const ME = 'acct-me-0001';
const LIN = 'acct-lin-0001';
const ZHOU = 'acct-zhou-0001';

afterEach(async () => {
  for (const started of opened.splice(0)) await started.close();
});

async function grouped(): Promise<{ t: TestApp; cookie: string; groupId: string }> {
  const t = await startTestApp([], { startTasks: false, network: { relayUrl: 'http://127.0.0.1:9', autoSync: false } });
  opened.push(t);
  const at = t.clock.now().toISOString();
  const me = generateIdentityKeys();
  t.state.networkIdentity.create({ accountId: ME, handle: 'alex', displayName: 'Alex',
    relayUrl: 'http://127.0.0.1:9', signingPublicKey: me.signing.publicKey, signingPrivateKey: me.signing.privateKey,
    encryptionPublicKey: me.encryption.publicKey, encryptionPrivateKey: me.encryption.privateKey, joinedAt: at });
  for (const [accountId, handle, name] of [[LIN, 'xiaolin', '小林'], [ZHOU, 'zhouke', '周可']] as const) {
    const keys = generateIdentityKeys();
    t.state.contacts.create({ accountId, handle, displayName: name, signingKey: keys.signing.publicKey,
      encryptionKey: keys.encryption.publicKey, relation: 'friend', state: 'active', lastAt: at });
  }
  const group = t.state.groups.create('grp-weekend-0001', { ownerAccountId: ME, name: '周末', avatar: null,
    lastAt: at });
  for (const [accountId, handle, displayName] of [[ME, 'alex', 'Alex'], [LIN, 'xiaolin', '小林'],
    [ZHOU, 'zhouke', '周可']] as const) {
    t.state.groupMembers.upsert(group.id, { accountId, handle, displayName });
  }
  return { t, cookie: await pair(t), groupId: group.id };
}

test('一句同时 @ 两个人的 Plasticine：各记一句同样的话、各问各的；再发同一个请求不重复', async () => {
  const { t, cookie, groupId } = await grouped();
  const body = { requestId: 'multi-ask-req-0001', text: '周六谁有空', aiOf: LIN, alsoAiOf: [ZHOU, LIN] };
  const sent = await post(t, cookie, `/v2/contacts/${groupId}/messages`, body);
  assert.deepEqual((sent['message'] as Body)['mention'], { name: '小林', self: false });
  const asks = t.state.groupMessages.recent(groupId, 10).filter((row) => row.kind === 'ask_ai');
  assert.deepEqual(asks.map((row) => [row.text, row.targetAccountId]).sort(),
    [['周六谁有空', LIN], ['周六谁有空', ZHOU]]);
  assert.equal(new Set(asks.map((row) => row.exchangeId)).size, 2, '各是各的一问一答');
  await post(t, cookie, `/v2/contacts/${groupId}/messages`, body);
  assert.equal(t.state.groupMessages.recent(groupId, 10).length, 2);
});

test('@ 了不在群里的人的 Plasticine：整句不发', async () => {
  const { t, cookie, groupId } = await grouped();
  const reply = await call(t, 'POST', `/v2/contacts/${groupId}/messages`, { cookie,
    body: { requestId: 'multi-ask-req-0002', text: '在吗', aiOf: LIN, alsoAiOf: ['acct-nobody-0001'] } });
  assert.equal(reply.status, 400, JSON.stringify(reply.body));
  assert.equal(json(reply)['field'], 'aiOf');
  assert.equal(t.state.groupMessages.recent(groupId, 10).length, 0);
});

const answer = (fields: Partial<ProxyAnswer>): ProxyAnswer =>
  ({ answer: '周六晴。', confident: true, usedMaterialIds: [], needsOwner: false, ...fields });

test('回答怎么办：说得准直接发；别人问的拿不准出卡；我自己 @ 的拿不准也出卡、没答成只记一句', () => {
  assert.equal(settleAction('answer', answer({})), 'send');
  assert.equal(settleAction('self', answer({})), 'send');
  assert.equal(settleAction('answer', answer({ needsOwner: true })), 'hold');
  assert.equal(settleAction('answer', null), 'hold');
  assert.equal(settleAction('self', answer({ needsOwner: true })), 'hold');
  assert.equal(settleAction('self', answer({ confident: false })), 'hold');
  assert.equal(settleAction('self', answer({ answer: '  ' })), 'note');
  assert.equal(settleAction('self', null), 'note');
});

test('给它的那段话：群里的对话写着是谁说的；我自己 @ 的写明替我对别人说话先给我看', () => {
  const question: Question = { origin: 'group', mode: 'self', contact: null,
    group: { id: 'grp-weekend-0001', name: '周末' } as Question['group'], questionId: 'q-1', text: '帮我回他',
    askerName: 'Alex', askerIsAi: false, exchangeId: 'x-1', reach: [], conversation: [
      { speaker: 'them', name: '小林', text: '周六去哪' },
      { speaker: 'their_ai', name: '周可', text: '周可周六有空。' },
      { speaker: 'me', text: '帮我回他' },
    ] };
  const prompt = sealedPrompt('Alex', question, []);
  assert.match(prompt, /小林：周六去哪/);
  assert.match(prompt, /周可 的 Plasticine：周可周六有空。/);
  assert.match(prompt, /主人：帮我回他/);
  assert.match(prompt, /needsOwner=true：这句先给主人一个人看/);
  assert.doesNotMatch(sealedPrompt('Alex', { ...question, mode: 'answer' }, []), /先给主人一个人看/);
});

test('我自己 @ 的那张确认卡：视图里带 self；点「这样发」把改过的那句当我的 Plasticine 的话发到群里', async () => {
  const { t, cookie, groupId } = await grouped();
  const ask = t.state.asks.create({
    kind: 'confirm', purpose: 'network_reply', channel: 'popup', question: '你让 Plasticine 在「周末」里回一句：帮我回他',
    options: [{ id: 'send', label: '这样发', description: null, recommended: true },
      { id: 'none', label: '不发', description: null, recommended: false }],
    context: { contactId: null, groupId, questionId: 'q-self-0001', exchangeId: 'x-self-0001', draft: '周六见。',
      askerIsAi: false, self: true, materials: [] },
  });
  const listed = json(await call(t, 'GET', '/v2/asks', { cookie }));
  const views = [listed['current'], ...(listed['queue'] as Body[])].filter((row) => row !== null) as Body[];
  assert.deepEqual(views.find((row) => row['id'] === ask.id)?.['networkReply'],
    { contactId: null, groupId, questionId: 'q-self-0001', draft: '周六见。', self: true });
  const answered = await call(t, 'POST', `/v2/asks/${ask.id}/answer`, { cookie,
    body: { requestId: 'self-answer-0001', optionId: 'send', text: '周六下午见。' } });
  assert.equal(answered.status, 200, JSON.stringify(answered.body));
  const said = t.state.groupMessages.recent(groupId, 10);
  assert.deepEqual(said.map((row) => [row.author, row.kind, row.text, row.targetAccountId, row.exchangeId]),
    [['my_ai', 'ai_text', '周六下午见。', ME, 'x-self-0001']]);
});
