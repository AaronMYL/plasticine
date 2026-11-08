// 联系人与网络的测试件：同进程的测试实例（各自的状态目录），全在 127.0.0.1 上，不出网、不用真模型。
// 开源版不带中继（docs/open-source-exclusions.md），要连中继的端到端测试不在这里。

import assert from 'node:assert/strict';
import { call, json, type TestApp } from '../app/helpers.ts';
import { newRequestId } from '../app/signing.ts';

export type Body = Record<string, unknown>;

export async function contacts(t: TestApp, cookie: string): Promise<Body> {
  const reply = await call(t, 'GET', '/v2/contacts', { cookie });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return json(reply);
}

export async function thread(t: TestApp, cookie: string, contactId: string): Promise<Body[]> {
  const reply = await call(t, 'GET', `/v2/contacts/${encodeURIComponent(contactId)}/messages`, { cookie });
  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  return json(reply)['items'] as Body[];
}

export async function post(t: TestApp, cookie: string, path: string, body: Body): Promise<Body> {
  const reply = await call(t, 'POST', path, { cookie, body: { requestId: newRequestId('rq'), ...body } });
  assert.ok(reply.status === 200 || reply.status === 201, `${path} → ${reply.status} ${JSON.stringify(reply.body)}`);
  return json(reply);
}
