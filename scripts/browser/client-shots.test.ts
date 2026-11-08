import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJobs } from './client-shots.ts';

test('截图清单按 schema 收：客户端、hash、主题和各种步骤', () => {
  const jobs = parseJobs([
    { name: '首页-mac', client: 'mac', hash: '#/today' },
    { name: '网页-phone', client: 'phone', hash: '#/today', theme: 'dark', steps: [
      'void 0', { wait: 200 }, { click: '[aria-label="更多"]' }, { clickText: '书签', within: '.web-menu' },
      { hover: '.tab' }, { circle: 'answer' },
    ] },
    { name: '网页-web', client: 'web', hash: '', query: '?from=shots' },
  ]);
  assert.equal(jobs.length, 3);
});

test('截图清单不对就说出哪一项：未知客户端、重名、名字带路径、hash 不是 #/ 开头、未知步骤', () => {
  assert.throws(() => parseJobs([{ name: 'a', client: 'android', hash: '#/today' }]), /client/);
  assert.throws(() => parseJobs([{ name: 'a', client: 'mac', hash: '#/a' }, { name: 'a', client: 'mac', hash: '' }]),
    /重名/);
  assert.throws(() => parseJobs([{ name: '../a', client: 'mac', hash: '' }]), /name/);
  assert.throws(() => parseJobs([{ name: 'a', client: 'mac', hash: 'today' }]), /hash/);
  assert.throws(() => parseJobs([{ name: 'a', client: 'mac', hash: '', steps: [{ teleport: 1 }] }]), /steps/);
  assert.throws(() => parseJobs([]), /截图清单不对/);
});
