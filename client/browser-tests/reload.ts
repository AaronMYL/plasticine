import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import type { Cdp } from '../../scripts/browser/cdp.ts';

const RELOAD_WAIT_MS = 15_000;
const POLL_MS = 25;

async function mainLoader(page: Cdp): Promise<string> {
  const response = await page.send('Page.getFrameTree');
  const tree = response['frameTree'] as { frame: { loaderId: string } };
  assert.equal(typeof tree?.frame?.loaderId, 'string', '主框架必须提供导航身份');
  return tree.frame.loaderId;
}

export async function reloadPage(page: Cdp): Promise<void> {
  await page.send('Page.enable');
  const before = await mainLoader(page);
  await page.send('Page.reload');
  const deadline = Date.now() + RELOAD_WAIT_MS;
  for (;;) {
    const after = await mainLoader(page);
    if (after !== before && await page.evaluate<boolean>(`document.readyState !== 'loading'`)) return;
    if (Date.now() >= deadline) throw new Error('浏览器刷新未完成新的主文档导航');
    await pause(POLL_MS);
  }
}
