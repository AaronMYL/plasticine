// PWA 细节（用户视角审查 2026-11-01 第 16 条）：index.html 浅 / 深两条 theme-color 和 iOS 状态栏样式；手动选深色时
// theme-color 跟着 data-theme 走；document.title 按视图写「笔记 · Plasticine」，今日页就叫「Plasticine」。

import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import { applyAppearance, saveAppearance } from '../../src/shell/appearance.ts';
import { renderApp, settle } from '../helpers.tsx';

function themeColors(): Array<{ media: string | null; content: string | null }> {
  return [...document.querySelectorAll('meta[name="theme-color"]')]
    .map((meta) => ({ media: meta.getAttribute('media'), content: meta.getAttribute('content') }));
}

/** 测试里的 document 是空的：把 index.html 里那几条 meta 放进 head，和真页面一样。 */
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

describe('PWA 的 meta 和标题', () => {
  it('index.html：浅 / 深各一条 theme-color（方向 I 的两个底色）和 iOS 状态栏样式', () => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const colors = [...parsed.querySelectorAll('meta[name="theme-color"]')]
      .map((meta) => [meta.getAttribute('media'), meta.getAttribute('content')?.toUpperCase()]);
    expect(colors).toEqual([['(prefers-color-scheme: light)', '#FCF9F6'], ['(prefers-color-scheme: dark)', '#2B2826']]);
    expect(parsed.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content'))
      .toBe('default');
  });

  it('手动选深色：两条 theme-color 都改成深底；选浅色都改成浅底；跟随系统就恢复各自的颜色', () => {
    installMeta();
    saveAppearance('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(themeColors().map((meta) => meta.content?.toUpperCase())).toEqual(['#2B2826', '#2B2826']);
    saveAppearance('light');
    expect(themeColors().map((meta) => meta.content?.toUpperCase())).toEqual(['#FCF9F6', '#FCF9F6']);
    saveAppearance('system');
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(themeColors()).toEqual([
      { media: '(prefers-color-scheme: light)', content: '#FCF9F6' },
      { media: '(prefers-color-scheme: dark)', content: '#2B2826' },
    ]);
  });

});
