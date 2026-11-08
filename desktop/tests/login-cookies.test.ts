import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loggedInSites } from '../src/logins/login-cookies.ts';

test('抖音、X 没登录时只有匿名 Cookie，不算登录着', () => {
  assert.deepEqual(loggedInSites([
    { domain: '.douyin.com', name: 'ttwid', value: 'a' },
    { domain: '.douyin.com', name: 'passport_csrf_token', value: 'b' },
    { domain: 'www.douyin.com', name: 'msToken', value: 'c' },
    { domain: '.x.com', name: 'guest_id', value: 'd' },
    { domain: '.x.com', name: 'gt', value: 'e' },
    { domain: '.x.com', name: 'ct0', value: 'f' },
  ]), []);
});

test('抖音看 sessionid / sessionid_ss / sid_guard，X 看 auth_token；值是空的不算', () => {
  assert.deepEqual(loggedInSites([
    { domain: '.douyin.com', name: 'sid_guard', value: 'a' },
    { domain: '.x.com', name: 'auth_token', value: '' },
    { domain: '.twitter.com', name: 'auth_token', value: 'b' },
  ]), ['douyin.com', 'twitter.com']);
});

test('别的网站：名字像登录凭证的才算，CSRF、访客、分析统计的不算', () => {
  assert.deepEqual(loggedInSites([
    { domain: 'github.com', name: 'user_session', value: 'a' },
    { domain: '.example.com', name: '_ga', value: 'b' },
    { domain: '.example.com', name: 'csrftoken', value: 'c' },
    { domain: '.news.example.org', name: 'visitor_id', value: 'd' },
    { domain: '.reddit.com', name: 'reddit_session', value: 'e' },
  ]), ['github.com', 'reddit.com']);
});
