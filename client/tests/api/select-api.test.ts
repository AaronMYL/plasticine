import { describe, expect, it } from 'vitest';
import { apiMode } from '../../src/api/select-api.ts';

describe('用哪一套接口', () => {
  it('生产构建默认连真接口，dev 和测试默认用假实现', () => {
    expect(apiMode({ PROD: true })).toBe('http');
    expect(apiMode({ PROD: false })).toBe('fake');
    expect(apiMode({ PROD: false, VITE_PLASTICINE_API: '' })).toBe('fake');
  });

  it('VITE_PLASTICINE_API=http 时 dev 也连真接口；=fake 时构建也用假的；写错了直接报错', () => {
    expect(apiMode({ PROD: false, VITE_PLASTICINE_API: 'http' })).toBe('http');
    expect(apiMode({ PROD: true, VITE_PLASTICINE_API: 'fake' })).toBe('fake');
    expect(() => apiMode({ PROD: false, VITE_PLASTICINE_API: 'real' })).toThrow('只能是 http 或 fake');
  });
});
