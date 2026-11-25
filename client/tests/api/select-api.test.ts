import { describe, expect, it } from 'vitest';
import { apiMode } from '../../src/api/select-api.ts';

describe('API backend selection', () => {
  it('production build defaults to real API; dev and test default to fake implementation', () => {
    expect(apiMode({ PROD: true })).toBe('http');
    expect(apiMode({ PROD: false })).toBe('fake');
    expect(apiMode({ PROD: false, VITE_PLASTICINE_API: '' })).toBe('fake');
  });

  it('VITE_PLASTICINE_API=http uses real API in dev, =fake in build, and throws on invalid value', () => {
    expect(apiMode({ PROD: false, VITE_PLASTICINE_API: 'http' })).toBe('http');
    expect(apiMode({ PROD: true, VITE_PLASTICINE_API: 'fake' })).toBe('fake');
    expect(() => apiMode({ PROD: false, VITE_PLASTICINE_API: 'real' })).toThrow('只能是 http 或 fake');
  });
});
