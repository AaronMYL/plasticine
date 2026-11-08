import { describe, expect, it } from 'vitest';
import { pairingAddress, pairingLink, readPairingInvitation } from '../../../src/views/login/pairing-link.ts';
import type { NetworkStatus } from '../../../src/api/shared.ts';

const invitation = { code: '7KQ4-M2XD', expiresAt: '2026-11-06T12:10:00.000Z' };
const network: NetworkStatus = { joined: true, relayUrl: 'https://cyberhunter.top', account: {
  id: 'account_1', handle: 'test', displayName: '测试', joinedAt: '2026-11-06T12:00:00.000Z',
  host: 'test.cyberhunter.top',
}, tunnel: { state: 'ready', detail: null }, lastSyncAt: null, lastError: null, inviteNeeded: false };

describe('设备配对链接', () => {
  it('码只放 fragment，保留真实八位码和期限，不带入查询串', () => {
    const link = new URL(pairingLink('https://test.cyberhunter.top', invitation));
    expect(link.search).toBe('');
    expect(link.pathname).toBe('/');
    expect(readPairingInvitation(link.hash)).toEqual(invitation);
    expect(readPairingInvitation('#/pair?code=bad')).toBeNull();
  });

  it('本机安装使用已准备好的真实网络地址；没有公网连接时不把 localhost 编成手机二维码', () => {
    expect(pairingAddress('http://127.0.0.1:8790', network)).toEqual({ url: 'https://test.cyberhunter.top',
      problem: null });
    expect(pairingAddress('http://127.0.0.1:8790', null).url).toBeNull();
    expect(pairingAddress('http://127.0.0.1:8790', { ...network,
      tunnel: { state: 'connecting', detail: null } }).url).toBeNull();
    expect(pairingAddress('https://my.example.test', null).url).toBe('https://my.example.test');
  });
});
