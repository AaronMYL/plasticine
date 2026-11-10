import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../../src/api/http/index.ts';
import { OUTBOUND_DEMO, outboundGrant, outboundLog } from '../../src/api/fake/outbound-seed.ts';
import { AT, eventSources, fakeFetch, json } from './http-fixtures.ts';

describe('真接口 · 对外授权', () => {
  it('列表、日志、修改与撤销使用共享格式和版本', async () => {
    const grant = outboundGrant(new Date(AT));
    const entry = outboundLog(new Date(AT));
    const { fetch, calls } = fakeFetch(() => json(200, { grants: [grant] }),
      () => json(200, { entries: [entry] }), () => json(200, { entry }),
      () => json(200, { grant }), () => json(200, { grant }), () => json(200, { grant }));
    const api = createHttpApi({ fetch, createEventSource: eventSources().create });
    expect(await api.outbound.grants()).toEqual([grant]);
    expect(await api.outbound.logs()).toEqual([entry]);
    expect(await api.outbound.log(entry.id)).toEqual(entry);
    await api.outbound.create({ requestId: 'request-create', grant: OUTBOUND_DEMO });
    await api.outbound.edit(grant.id, { requestId: 'request-edit', version: 1, patch: { enabled: false } });
    await api.outbound.revoke(grant.id, { requestId: 'request-revoke', version: 1 });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /v2/outbound/grants', 'GET /v2/outbound/log', `GET /v2/outbound/log/${entry.id}`,
      'POST /v2/outbound/grants', `PUT /v2/outbound/grants/${grant.id}`,
      `POST /v2/outbound/grants/${grant.id}/revoke`,
    ]);
    expect(calls[4]?.body).toEqual({ requestId: 'request-edit', version: 1, patch: { enabled: false } });
  });
});
