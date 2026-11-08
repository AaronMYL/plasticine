// 设备钥匙：配对之后马上生成并登记；私钥不可导出、不进 sessionStorage / localStorage；已经登记过的设备刷新后
// 接上；配对超过 10 分钟没登记过的，就地说清楚要重新配对；登记的回执丢了，重发一字不差的请求体。

import { describe, expect, it, vi } from 'vitest';
import type { DeviceKeysApi } from '../../src/api/client.ts';
import { MemoryDeviceKeyStore } from '../../src/api/device-key-store.ts';
import { importPublicJwk, thumbprintOf, verifyRequest } from '../../src/api/device-signature.ts';
import { ApiError, uncertainError } from '../../src/api/errors.ts';
import type { DeviceKeyView, PublicKeyJwk } from '../../src/api/types.ts';
import { DeviceKeyring } from '../../src/state/device-keyring.ts';
import { memoryStorage } from '../helpers.tsx';

const AT = '2026-10-27T02:00:00.000Z';

/** 一个只管设备钥匙的假服务端：记下每次登记的原样请求体。 */
function keyServer(options: { tooLate?: boolean; lose?: number } = {}) {
  const bodies: string[] = [];
  let registered: { jwk: PublicKeyJwk; view: DeviceKeyView } | null = null;
  let lose = options.lose ?? 0;
  const api: DeviceKeysApi = {
    current: async () => registered?.view ?? null,
    register: async (bodyText) => {
      bodies.push(bodyText);
      if (options.tooLate === true) {
        throw new ApiError({
          kind: 'invalid',
          code: 'device_key_too_late',
          message: '这台设备配对已经超过 10 分钟，不能再登记签名钥匙。',
          status: 403,
        });
      }
      const parsed: { publicKey: PublicKeyJwk } = JSON.parse(bodyText);
      const view = { id: 'key_1', deviceId: 'dev_1', thumbprint: await thumbprintOf(parsed.publicKey), createdAt: AT };
      registered = { jwk: parsed.publicKey, view };
      if (lose > 0) {
        lose -= 1;
        throw uncertainError('登记签名钥匙');
      }
      return view;
    },
  };
  return { api, bodies, registeredJwk: () => registered?.jwk ?? null };
}

describe('设备钥匙', () => {
  it('配对后生成并登记：私钥不可导出，sessionStorage / localStorage 里没有钥匙', async () => {
    const store = new MemoryDeviceKeyStore();
    const session = memoryStorage();
    const keyring = new DeviceKeyring(store);
    const server = keyServer();
    await keyring.prepare(server.api, 'dev_1');
    expect(keyring.status.get()).toMatchObject({ kind: 'ready' });
    const stored = await store.load();
    expect(stored?.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', stored!.privateKey)).rejects.toThrow();
    const body = server.bodies[0] ?? '';
    expect(JSON.parse(body)).toMatchObject({ requestId: expect.stringMatching(/^req_/), publicKey: { kty: 'EC' } });
    expect(body).not.toContain('"d"');
    expect([...session.data.values()].join('')).not.toContain('EC');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('签出来的签名用登记的那把公钥验得过', async () => {
    const keyring = new DeviceKeyring(new MemoryDeviceKeyStore());
    const server = keyServer();
    await keyring.prepare(server.api, 'dev_1');
    const input = { method: 'POST', path: '/v2/agreements/a_1/confirm', requestId: 'req_abcdefgh', bodyText: '{}' };
    const signed = await keyring.sign(input, new Date(AT));
    expect(signed.signedAt).toBe(AT);
    const jwk = server.registeredJwk();
    expect(jwk).not.toBeNull();
    const publicKey = await importPublicJwk(jwk!);
    expect(await verifyRequest(publicKey, { ...input, signedAt: AT }, signed.signature)).toBe(true);
  });

  it('已经登记过的设备再打开：认出服务端那把就是这把，不再登记、不换钥匙', async () => {
    const store = new MemoryDeviceKeyStore();
    const server = keyServer();
    await new DeviceKeyring(store).prepare(server.api, 'dev_1');
    const before = await store.load();
    const reopened = new DeviceKeyring(store);
    await reopened.prepare(server.api, 'dev_1');
    expect(reopened.status.get()).toMatchObject({ kind: 'ready' });
    expect(server.bodies).toHaveLength(1);
    expect((await store.load())?.privateKey).toBe(before?.privateKey);
  });

  it('登记的回执丢了：再试一次发的是一字不差的同一个请求体（同一 requestId、同一把公钥）', async () => {
    const store = new MemoryDeviceKeyStore();
    const server = keyServer({ lose: 1 });
    const keyring = new DeviceKeyring(store);
    vi.spyOn(server.api, 'current').mockResolvedValueOnce(null);
    await keyring.prepare(server.api, 'dev_1');
    expect(keyring.status.get()).toMatchObject({ kind: 'error' });
    vi.spyOn(server.api, 'current').mockResolvedValueOnce(null);
    await keyring.prepare(server.api, 'dev_1');
    expect(keyring.status.get()).toMatchObject({ kind: 'ready' });
    expect(server.bodies).toHaveLength(2);
    expect(server.bodies[1]).toBe(server.bodies[0]);
  });

  it('配对超过 10 分钟、没登记过：状态是「没有钥匙」，签名前就停下，说清楚要重新配对', async () => {
    const keyring = new DeviceKeyring(new MemoryDeviceKeyStore());
    await keyring.prepare(keyServer({ tooLate: true }).api, 'dev_1');
    expect(keyring.status.get()).toEqual({ kind: 'missing', reason: 'too_late' });
    const input = { method: 'POST', path: '/v2/judgments/j/p', requestId: 'req_abcdefgh', bodyText: '{}' };
    await expect(keyring.sign(input, new Date(AT))).rejects.toMatchObject({
      code: 'device_key_missing',
      message: expect.stringContaining('重新配对后才能授权设备动作、恢复备份、解锁私密笔记'),
    });
  });

  it('服务端登记的是另一把（这台浏览器的钥匙丢了）：状态是「没有钥匙」，不去换', async () => {
    const server = keyServer();
    await new DeviceKeyring(new MemoryDeviceKeyStore()).prepare(server.api, 'dev_1');
    const fresh = new DeviceKeyring(new MemoryDeviceKeyStore());
    vi.spyOn(server.api, 'register').mockRejectedValue(
      new ApiError({ kind: 'failed', code: 'device_key_exists', message: '已经登记过另一把', status: 409 }),
    );
    await fresh.prepare(server.api, 'dev_1');
    expect(fresh.status.get()).toEqual({ kind: 'missing', reason: 'other_key' });
  });

  it('重新配对成了另一台设备：换一把新钥匙登记', async () => {
    const store = new MemoryDeviceKeyStore();
    const keyring = new DeviceKeyring(store);
    await keyring.prepare(keyServer().api, 'dev_1');
    const first = await store.load();
    await keyring.prepare(keyServer().api, 'dev_2');
    const second = await store.load();
    expect(second?.deviceId).toBe('dev_2');
    expect(second?.privateKey).not.toBe(first?.privateKey);
    expect(keyring.status.get()).toMatchObject({ kind: 'ready' });
  });

  it('两个标签页同时打开、存储里还没有钥匙：最后只有一把，两边用的是同一把，签名都验得过', async () => {
    const store = new MemoryDeviceKeyStore();
    const server = keyServer();
    const first = new DeviceKeyring(store);
    const second = new DeviceKeyring(store);
    await Promise.all([first.prepare(server.api, 'dev_1'), second.prepare(server.api, 'dev_1')]);
    expect(first.status.get()).toMatchObject({ kind: 'ready' });
    expect(second.status.get()).toEqual(first.status.get());
    const stored = await store.load();
    expect(new Set(server.bodies).size).toBe(1);
    const input = { method: 'POST', path: '/v2/judgments/j/p', requestId: 'req_abcdefgh', bodyText: '{}' };
    const publicKey = await importPublicJwk(server.registeredJwk()!);
    for (const keyring of [first, second]) {
      const signed = await keyring.sign(input, new Date(AT));
      expect(await verifyRequest(publicKey, { ...input, signedAt: AT }, signed.signature)).toBe(true);
    }
    expect(stored?.publicJwk).toEqual(server.registeredJwk());
  });

  it('另一个标签页已经换成新设备的钥匙：这边改状态不覆盖它', async () => {
    const store = new MemoryDeviceKeyStore();
    await new DeviceKeyring(store).prepare(keyServer().api, 'dev_1');
    const old = await store.load();
    await new DeviceKeyring(store).prepare(keyServer().api, 'dev_2');
    await store.update({ ...old!, state: 'too_late' });
    expect((await store.load())?.deviceId).toBe('dev_2');
  });

  it('跨标签页的锁：取用、生成、登记都在锁里做', async () => {
    const store = new MemoryDeviceKeyStore();
    const lock = vi.fn(async (run: () => Promise<void>) => run());
    await new DeviceKeyring(store, lock).prepare(keyServer().api, 'dev_1');
    expect(lock).toHaveBeenCalledTimes(1);
    expect(await store.load()).not.toBeNull();
  });

  it('没有地方存钥匙（没有 IndexedDB）：就地说这台设备签不了名', async () => {
    const keyring = new DeviceKeyring(null);
    await keyring.prepare(keyServer().api, 'dev_1');
    expect(keyring.status.get()).toMatchObject({ kind: 'unsupported' });
  });
});
