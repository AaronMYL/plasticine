// Vitest 每个测试文件的公共准备：每条测试后卸载组件；补上 jsdom 没有、ProseMirror 和壳要用的几个浏览器接口，
// 以及设备签名要用的 WebCrypto。

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

const EMPTY_RECT: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};

function emptyRects(): DOMRectList {
  const list: DOMRect[] = [];
  return Object.assign(list, { item: (): DOMRect | null => null }) as unknown as DOMRectList;
}

if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect = () => EMPTY_RECT;
  Range.prototype.getClientRects = emptyRects;
}

if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined;
}

// 设备签名的测试要真的 WebCrypto：jsdom 没带 crypto.subtle 时换上 Node 的 webcrypto。模块名放在变量里，客户端的
// typecheck 不带 Node 的类型，读出来的东西先查形状再用。
if (globalThis.crypto?.subtle === undefined) {
  const name = 'node:crypto';
  const loaded: unknown = await import(/* @vite-ignore */ name);
  const hasWebcrypto = typeof loaded === 'object' && loaded !== null && 'webcrypto' in loaded;
  const webcrypto: unknown = hasWebcrypto ? loaded.webcrypto : null;
  if (typeof webcrypto !== 'object' || webcrypto === null || !('subtle' in webcrypto)) {
    throw new Error('Node 的 node:crypto 里没有 webcrypto，签名测试跑不了');
  }
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
}
