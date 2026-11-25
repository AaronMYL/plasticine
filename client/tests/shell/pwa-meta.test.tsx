import { afterEach, describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { applyAppearance, saveAppearance } from '../../src/shell/appearance.ts';

function themeColors(): Array<{ media: string | null; content: string | null }> {
  return [...document.querySelectorAll('meta[name="theme-color"]')]
    .map((meta) => ({ media: meta.getAttribute('media'), content: meta.getAttribute('content') }));
}

function installMeta(): void {
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('meta[name="theme-color"]').forEach((meta) => document.head.append(meta.cloneNode()));
}

afterEach(() => {
  localStorage.removeItem('plasticine.appearance');
  applyAppearance('system');
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove());
});

describe('PWA meta tags and title', () => {
  it('index.html defines light and dark theme-color tags and iOS status bar style', () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const colors = [...parsed.querySelectorAll('meta[name="theme-color"]')]
      .map((meta) => [meta.getAttribute('media'), meta.getAttribute('content')?.toUpperCase()]);
    expect(colors).toEqual([['(prefers-color-scheme: light)', '#FAF8F4'], ['(prefers-color-scheme: dark)', '#1C1B19']]);
    expect(parsed.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content'))
      .toBe('default');
  });

  it('manual dark/light theme updates both theme-color tags; system mode restores each', () => {
    installMeta();
    saveAppearance('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(themeColors().map((meta) => meta.content?.toUpperCase())).toEqual(['#1C1B19', '#1C1B19']);
    saveAppearance('light');
    expect(themeColors().map((meta) => meta.content?.toUpperCase())).toEqual(['#FAF8F4', '#FAF8F4']);
    saveAppearance('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(themeColors()).toEqual([
      { media: '(prefers-color-scheme: light)', content: '#FAF8F4' },
      { media: '(prefers-color-scheme: dark)', content: '#1C1B19' },
    ]);
  });

});
