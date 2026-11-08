import assert from 'node:assert/strict';
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { test } from 'node:test';
import { clearedCookie, sendJson, sessionCookie } from '../../src/app/http.ts';
import { CLEAN_LINK_TEXT, CREDENTIAL_LINK_TEXT } from '../url-fixtures.ts';

test('统一 JSON 出口清洗成功和错误响应的任意嵌套文本，长度按清洗后的 UTF-8 计算', () => {
  for (const status of [200, 201, 409, 500]) {
    let sent = '';
    let sentStatus = 0;
    let headers: OutgoingHttpHeaders = {};
    const response = {
      writeHead(code: number, value: OutgoingHttpHeaders) {
        sentStatus = code;
        headers = value;
      },
      end(text: string) {
        sent = text;
      },
    } as unknown as ServerResponse;
    const body = { current: [{ arbitrary: CREDENTIAL_LINK_TEXT }], error: 'u:p@x.example' };
    sendJson(response, status, body);
    assert.equal(sentStatus, status);
    assert.deepEqual(JSON.parse(sent), { current: [{ arbitrary: CLEAN_LINK_TEXT }], error: 'u:p@x.example' });
    assert.equal(headers['content-length'], Buffer.byteLength(sent));
    assert.equal(body.current[0]?.arbitrary, CREDENTIAL_LINK_TEXT);
  }
});

test('会话 cookie 默认带 Secure；安装包走 127.0.0.1 明文 http 时不带（WebKit 不收明文下的 Secure cookie）', () => {
  assert.equal(sessionCookie('s', 't', 60_000, {}), 's=t; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Strict');
  assert.equal(sessionCookie('s', 't', 60_000, { PLASTICINE_PLAIN_HTTP: '1' }),
    's=t; Path=/; Max-Age=60; HttpOnly; SameSite=Strict');
  assert.equal(clearedCookie('s', {}), 's=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
  assert.equal(clearedCookie('s', { PLASTICINE_PLAIN_HTTP: '1' }), 's=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict');
});
