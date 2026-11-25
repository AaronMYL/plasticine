import assert from 'node:assert/strict';
import { call, json, type TestApp, newRequestId } from '../app/helpers.ts';

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
