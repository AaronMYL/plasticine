// M5 甲路的真实现：路径、请求体照 shared；撤销回执丢了算结果待核实；本人确认操作发到 signedPath，409 带 current 的换成
// ConflictError；回答不合 schema 是读失败；事件流认节点、设备动作两种，认不出的当作补不上了。

import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../src/api/errors.ts';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import type { LiveEvent, NodeView } from '../../src/api/types.ts';
import { NOW } from '../helpers.tsx';
import { AT, eventSources, fakeFetch, json } from './http-fixtures.ts';

function node(): NodeView {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  return fake.control.nodes.addNode('家里的 Mac');
}


describe('真接口 · 执行节点', () => {
  it('GET /v2/nodes 和 /v2/nodes/actions?nodeId=；回答照 shared 校验', async () => {
    const view = node();
    const listBody = { nodes: [view], defaults: view.limits, protectedPaths: ['~/.ssh/**（密钥）'] };
    const { fetch, calls } = fakeFetch(() => json(200, listBody), () => json(200, { actions: [] }));
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    const list = await http.nodes.list();
    expect(list.nodes[0]?.name).toBe('家里的 Mac');
    expect(await http.nodes.actions('node 1')).toEqual([]);
    expect(calls.map((call) => call.url)).toEqual(['/v2/nodes', '/v2/nodes/actions?nodeId=node+1']);
  });

  it('撤销：POST /v2/nodes/:id/revoke 带 requestId；连接断了算结果待核实', async () => {
    const { fetch, calls } = fakeFetch(() => new TypeError('Failed to fetch'));
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    const failure = await http.nodes.revoke('node_1', { requestId: 'req_00000001' }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'uncertain' });
    const sent = { method: 'POST', url: '/v2/nodes/node_1/revoke', body: { requestId: 'req_00000001' } };
    expect(calls[0]).toMatchObject(sent);
  });

  it('改上限：本人会话与原样请求体发到节点入口；409 带 current 是 ConflictError', async () => {
    const current = { ...node(), limitsVersion: 2, version: 4 };
    const { fetch, calls } = fakeFetch(() => json(409, { error: '上限刚刚在别处改过。', code: 'version_conflict', current }));
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    const bodyText = JSON.stringify({ requestId: 'req_00000002', limitsVersion: 1, limits: current.limits });
    const failure = await http.signed
      .send({ target: { kind: 'node_limits', nodeId: 'node_1' }, bodyText })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictError);
    expect(failure).toMatchObject({ current: { limitsVersion: 2 } });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/nodes/node_1/limits' });
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signed-at');
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signature');
  });

  it('领配对码：本人会话发到 /v2/nodes/pairing-codes，回答里的码交出去', async () => {
    const { fetch, calls } = fakeFetch(() => json(201, { code: 'K7QM-ABCD', expiresAt: AT }));
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    const result = await http.signed.send({
      target: { kind: 'node_pairing_code' },
      bodyText: JSON.stringify({ requestId: 'req_00000003' }),
    });
    expect(result).toEqual({ kind: 'node_code', code: { code: 'K7QM-ABCD', expiresAt: AT } });
    expect(calls[0]?.url).toBe('/v2/nodes/pairing-codes');
  });
});

describe('真接口 · 事件流里的节点、设备动作', () => {
  it('两种事件整行带过来；认不出的当作补不上了', () => {
    const sources = eventSources();
    const http = createHttpApi({ fetch: fakeFetch(() => json(200, {})).fetch, createEventSource: sources.create });
    const events: LiveEvent[] = [];
    http.events.subscribe({ onEvent: (event) => events.push(event), onStatus: () => undefined });
    const source = sources.created[0];
    const types = ['node_changed', 'node_action_recorded'];
    expect(source?.types).toEqual(expect.arrayContaining(types));
    source?.emit('node_changed', { type: 'node_changed', node: node() }, 'e-1');
    source?.emit('node_action_recorded', { type: 'node_action_recorded', action: { id: 'x' } }, 'e-3');
    expect(events.map((event) => event.type)).toEqual(['node.changed', 'resync']);
  });
});
