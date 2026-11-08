import assert from 'node:assert/strict';
import { test } from 'node:test';
import { internalPageHash } from '../../shared/internal-page.ts';

test('本实例根文档识别路由，端口、协议、附件和配对查询不能误认', () => {
  const server = 'https://plasticine.test/';
  assert.equal(internalPageHash('https://plasticine.test:443/#/notes/n1', server), '#/notes/n1');
  assert.equal(internalPageHash('https://plasticine.test/#/books/b1/2/20', server), '#/books/b1/2/20');
  assert.equal(internalPageHash(server, server), '#/today');
  for (const url of ['https://other.test/#/notes', 'http://plasticine.test/#/notes',
    'https://plasticine.test:444/#/notes', 'https://plasticine.test/v2/notes',
    'https://plasticine.test/attachment.png', 'https://plasticine.test/?code=example',
    'https://user@plasticine.test/#/notes', 'https://plasticine.test/#access_token=example']) {
    assert.equal(internalPageHash(url, server), null, url);
  }
});
