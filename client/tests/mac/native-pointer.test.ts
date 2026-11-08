// 点在原生网页标签上（第 3 条）：原生调 window.__plasticineNativePointer()，window 上发 NATIVE_POINTER_EVENT。

import { afterEach, describe, expect, it } from 'vitest';
import { installNativePointer, NATIVE_POINTER_EVENT } from '../../src/mac/native-pointer.ts';

afterEach(() => {
  delete window.__plasticineNativePointer;
});

describe('原生网页标签上的点击', () => {
  it('原生调入口后 window 上发一次事件；重复安装不叠加', () => {
    installNativePointer();
    installNativePointer();
    let heard = 0;
    const listen = (): void => {
      heard += 1;
    };
    window.addEventListener(NATIVE_POINTER_EVENT, listen);
    window.__plasticineNativePointer?.();
    window.removeEventListener(NATIVE_POINTER_EVENT, listen);
    expect(NATIVE_POINTER_EVENT).toBe('plasticine:native-pointer');
    expect(heard).toBe(1);
  });
});
