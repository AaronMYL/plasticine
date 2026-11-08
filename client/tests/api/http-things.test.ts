// 第 102 条第 2 批：记忆主题的真实现发往服务端真路由（agent/src/app/router.ts），回答按 shared 的 schema 校验；
// 拿不准的对 / 不对由本人会话确认。

import { describe, expect, it } from 'vitest';
import { createHttpApi } from '../../src/api/http/index.ts';
import { eventSources, fakeFetch, json } from './http-fixtures.ts';

const AT = '2026-11-02T08:00:00.000Z';
const UNCERTAIN = { id: 'u1', text: '早上通勤', basis: '三次提到', topicId: 't1', topicTitle: '关于你',
  inferredAt: AT, status: 'confirmed', correction: null };

describe('记忆主题的真实现', () => {
  it('拿不准的对 / 不对：本人会话发往记忆入口，原样请求体不带签名头', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, UNCERTAIN));
    const http = createHttpApi({ fetch, createEventSource: eventSources().create });
    const bodyText = '{"requestId":"req_u_1","answer":"yes","correction":null}';
    const result = await http.signed.send({ target: { kind: 'memory_uncertain', uncertainId: 'u1' }, bodyText });
    expect(result).toEqual({ kind: 'memory_uncertain', item: UNCERTAIN });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v2/memory/uncertain/u1' });
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signature');
    expect(calls[0]?.headers).not.toHaveProperty('x-plasticine-signed-at');
  });
});
