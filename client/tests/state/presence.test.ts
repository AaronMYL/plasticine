// 前台记录（2026-11-05 首页「离开时」）：离开按 App 在不在前台算，离开 ≥ 1 小时回来才记一段；那一行露过之后，
// 下次回到前台到再离开 1 小时以上之前不再出现；存在 localStorage，换一次打开也认得。

import { describe, expect, it } from 'vitest';
import { PRESENCE_STORAGE_KEY, PresenceTracker } from '../../src/state/presence.ts';
import { memoryStorage } from '../helpers.tsx';

const START = new Date('2026-11-05T09:00:00+08:00');
const MINUTE_MS = 60_000;

function tracker(storage = memoryStorage()) {
  let clock = START;
  const presence = new PresenceTracker(storage, () => clock);
  return { presence, storage, at: (minutes: number) => { clock = new Date(START.getTime() + minutes * MINUTE_MS); } };
}

describe('前台记录', () => {
  it('第一次打开没有离开过；离开 ≥ 1 小时再回来记下那一段', () => {
    const { presence, at } = tracker();
    presence.visible();
    expect(presence.view.get()).toEqual({ away: null, show: false });
    at(10);
    presence.hidden();
    at(80);
    presence.visible();
    expect(presence.view.get().away).toEqual({ since: new Date(START.getTime() + 10 * MINUTE_MS).toISOString(),
      until: new Date(START.getTime() + 80 * MINUTE_MS).toISOString() });
    expect(presence.view.get().show).toBe(true);
  });

  it('离开不到 1 小时不算', () => {
    const { presence, at } = tracker();
    presence.visible();
    presence.hidden();
    at(59);
    presence.visible();
    expect(presence.view.get().show).toBe(false);
  });

  it('露过之后：这一次照常显示，切走一会儿回来就不再出现', () => {
    const { presence, at } = tracker();
    presence.visible();
    presence.hidden();
    at(120);
    presence.visible();
    presence.markSeen();
    expect(presence.view.get().show).toBe(true);
    at(125);
    presence.hidden();
    at(130);
    presence.visible();
    expect(presence.view.get().show).toBe(false);
  });

  it('关掉再打开（新的一次）：从 localStorage 认出上次在前台的时间', () => {
    const first = tracker();
    first.presence.visible();
    first.at(30);
    first.presence.beat();
    expect(JSON.parse(first.storage.getItem(PRESENCE_STORAGE_KEY) ?? '{}').lastVisibleAt)
      .toBe(new Date(START.getTime() + 30 * MINUTE_MS).toISOString());
    const second = tracker(first.storage);
    second.at(300);
    second.presence.visible();
    expect(second.presence.view.get().show).toBe(true);
  });
});
