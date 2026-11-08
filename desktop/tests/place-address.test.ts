import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayPlace, parsePlaceAddress, PlaceAddressError } from '../src/app/place-address.ts';

test('@账号、不带 @ 的账号、子域名、完整网址都认，规整成 https 源地址', () => {
  for (const input of ['@sample_user', 'sample_user', ' @Sample_User ', 'sample-user.cyberhunter.top',
    'https://sample-user.cyberhunter.top', 'https://sample-user.cyberhunter.top/']) {
    assert.equal(parsePlaceAddress(input).url, 'https://sample-user.cyberhunter.top/', input);
  }
  assert.equal(parsePlaceAddress('@sample_user').handle, 'sample_user');
  assert.equal(parsePlaceAddress('sample-user.cyberhunter.top').handle, null);
  assert.equal(parsePlaceAddress('203.0.113.7:8443').url, 'https://203.0.113.7:8443/');
});

test('不合规的写法给一句中文原因', () => {
  for (const bad of ['', '   ', '@ab', '@a-bc', '@a b', '@名字', 'http://sample.example', 'https://a.b/path',
    'https://u:p@a.b', '@' + 'a'.repeat(25)]) {
    assert.throws(() => parsePlaceAddress(bad), PlaceAddressError, bad);
  }
});

test('预填时 @账号的网址写回 @账号，别的地址只留主机', () => {
  assert.equal(displayPlace('https://sample-user.cyberhunter.top/'), '@sample_user');
  assert.equal(displayPlace('https://203.0.113.7:8443/'), '203.0.113.7:8443');
  assert.equal(displayPlace('https://plasticine.example.org/'), 'plasticine.example.org');
  assert.equal(displayPlace('不是网址'), '');
});
