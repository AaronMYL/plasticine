import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { imageViewerStore } from '../src/primitives/image-viewer/index.tsx';
import { toastStore } from '../src/primitives/toast/index.tsx';

afterEach(() => {
  cleanup();
  toastStore.set(null);
  imageViewerStore.set(null);
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
