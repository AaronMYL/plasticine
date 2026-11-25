import { afterEach, describe, expect, it } from 'vitest';
import { installNativePointer, NATIVE_POINTER_EVENT } from '../../src/mac/native-pointer.ts';

afterEach(() => {
  delete window.__plasticineNativePointer;
});

describe('native web tab click handling', () => {
  it('native entry dispatches window event once; repeated installs do not duplicate listeners', () => {
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
