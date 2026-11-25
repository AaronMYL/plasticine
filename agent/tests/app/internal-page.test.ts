import assert from 'node:assert/strict';
import { test } from 'node:test';
import { internalPageHash } from '../../shared/internal-page.ts';

test('instance root document detection ignores mismatched port, scheme, attachments, and pairing', () => {
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

test('empty or blank URL is not treated as app home page', () => {
  const server = 'https://plasticine.test/';
  assert.equal(internalPageHash('', server), null);
  assert.equal(internalPageHash('  ', server), null);
});
