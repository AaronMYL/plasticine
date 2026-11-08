import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from '../../scripts/browser/cdp.ts';

test('真实 IndexedDB：不可导出 CryptoKey 跨页持久化、并发 claim 与旧 update 不覆盖新设备', async () => {
  const vite = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
    logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'key-test-page',
      configureServer(server) {
        server.middlewares.use('/key-test', (_req, res) => {
          res.end('<!doctype html><title>IndexedDB test</title>');
        });
      },
    }] });
  await vite.listen();
  const address = vite.httpServer?.address();
  assert.ok(address !== null && typeof address === 'object');
  const browser = await launchBrowser();
  try {
    const url = `http://127.0.0.1:${address.port}/key-test`;
    const a = await browser.page(url);
    const b = await browser.page(url);
    const setup = `(async () => {
      const { IndexedDbDeviceKeyStore } = await import('/src/api/device-key-store.ts');
      window.store = new IndexedDbDeviceKeyStore(indexedDB);
      window.candidate = async (deviceId) => {
        const pair = await crypto.subtle.generateKey({name:'ECDSA', namedCurve:'P-256'}, false, ['sign','verify']);
        const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
        return {deviceId, privateKey:pair.privateKey, publicKey:pair.publicKey,
          publicJwk:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y}, state:'pending', registerBody:'synthetic-registration'};
      };
      window.key = await candidate('test-device');
      return true;
    })()`;
    await Promise.all([a.evaluate(setup), b.evaluate(setup)]);
    const claims = await Promise.all([a, b].map((page) => page.evaluate<string>(
      '(async () => { window.key = await store.claim(key); return key.publicJwk.x; })()',
    )));
    assert.equal(claims[0], claims[1]);
    const c = await browser.page(url);
    await c.evaluate(setup);
    const persisted = await c.evaluate<{ x: string; verified: boolean; exportRefused: boolean }>(`(async () => {
      const loaded = await store.load();
      const data = new TextEncoder().encode('synthetic persistence check');
      const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, loaded.privateKey, data);
      const verified = await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, loaded.publicKey, signature, data);
      let exportRefused = false;
      try { await crypto.subtle.exportKey('jwk', loaded.privateKey); } catch { exportRefused = true; }
      return {x:loaded.publicJwk.x, verified, exportRefused};
    })()`);
    assert.deepEqual(persisted, { x: claims[0], verified: true, exportRefused: true });
    await b.evaluate(`(async () => { window.fresh = await candidate('new-device'); await store.claim(fresh); })()`);
    await a.evaluate('store.update({...key, state:"registered"})');
    assert.equal(await c.evaluate('(async () => (await store.load()).deviceId)()'), 'new-device');
    await Promise.all([a.evaluate('store.update({...key, state:"too_late"})'),
      b.evaluate('store.update({...fresh, state:"registered"})')]);
    assert.equal(await c.evaluate('(async () => (await store.load()).state)()'), 'registered');
  } finally {
    await browser.close();
    await vite.close();
  }
});
