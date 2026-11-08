import { expect, it } from 'vitest';
import { createHttpApi } from '../../src/api/http/index.ts';
import { eventSources, fakeFetch, json } from './http-fixtures.ts';

it('技能接口使用共享校验、查询分页与版本固定；删技能是 DELETE 带 requestId', async () => {
  const { fetch, calls } = fakeFetch(
    () => json(200, { skills: [], issues: [], total: 0, nextOffset: null }),
    () => json(200, { skill: {} }),
    () => json(200, { name: 'research-notes' }),
  );
  const api = createHttpApi({ fetch, createEventSource: eventSources().create });
  await api.skills.list({ query: '整理 资料', offset: 20, limit: 20 });
  await expect(api.skills.read('research-notes', { version: 'a'.repeat(64), path: 'references/a.md', offset: 8000 }))
    .rejects.toMatchObject({ kind: 'failed' });
  await api.skills.remove('research-notes', 'req_skill_0001');
  expect(calls[0]?.url).toBe('/v2/skills?query=%E6%95%B4%E7%90%86+%E8%B5%84%E6%96%99&offset=20&limit=20');
  expect(calls[1]?.url).toContain(`version=${'a'.repeat(64)}&path=references%2Fa.md&offset=8000`);
  expect(calls[2]).toMatchObject({ method: 'DELETE', url: '/v2/skills/research-notes',
    body: { requestId: 'req_skill_0001' } });
});
