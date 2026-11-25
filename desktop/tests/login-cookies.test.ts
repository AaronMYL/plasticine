import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loggedInSites } from '../src/logins/login-cookies.ts';

test('anonymous cookies on Douyin and X do not count as signed in', () => {
  assert.deepEqual(loggedInSites([
    { domain: '.douyin.com', name: 'ttwid', value: 'a' },
    { domain: '.douyin.com', name: 'passport_csrf_token', value: 'b' },
    { domain: 'www.douyin.com', name: 'msToken', value: 'c' },
    { domain: '.x.com', name: 'guest_id', value: 'd' },
    { domain: '.x.com', name: 'gt', value: 'e' },
    { domain: '.x.com', name: 'ct0', value: 'f' },
  ]), []);
});

test('checks non-empty sessionid/sessionid_ss/sid_guard for Douyin and auth_token for X', () => {
  assert.deepEqual(loggedInSites([
    { domain: '.douyin.com', name: 'sid_guard', value: 'a' },
    { domain: '.x.com', name: 'auth_token', value: '' },
    { domain: '.twitter.com', name: 'auth_token', value: 'b' },
  ]), ['douyin.com', 'twitter.com']);
});

test('Reddit requires reddit_session and ignores anonymous token_v2', () => {
  assert.deepEqual(loggedInSites([
    { domain: '.reddit.com', name: 'token_v2', value: 'a' },
    { domain: '.reddit.com', name: 'loid', value: 'b' },
  ]), []);
  assert.deepEqual(loggedInSites([{ domain: '.reddit.com', name: 'reddit_session', value: 'c' }]), ['reddit.com']);
});

test('other sites count only auth-like cookie names, ignoring CSRF, guest, and analytics cookies', () => {
  assert.deepEqual(loggedInSites([
    { domain: 'github.com', name: 'user_session', value: 'a' },
    { domain: '.example.com', name: '_ga', value: 'b' },
    { domain: '.example.com', name: 'csrftoken', value: 'c' },
    { domain: '.news.example.org', name: 'visitor_id', value: 'd' },
    { domain: '.reddit.com', name: 'reddit_session', value: 'e' },
  ]), ['github.com', 'reddit.com']);
});
