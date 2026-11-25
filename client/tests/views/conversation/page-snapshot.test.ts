import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { capturePageSnapshot, parsePageQuote, snapshotMarker, withSnapshot }
  from '../../../src/views/conversation/page-snapshot.ts';

const TAB = { id: 'web-1', kind: 'web' as const, title: '协作中的上下文', url: 'https://example.org/article', route: null };
const JPEG = { type: 'image/jpeg', base64: btoa('not-a-real-jpeg-but-bytes') };

afterEach(() => { delete window.plasticineDesktop; });

describe('recognizing web page quote chips', () => {
  it('extracts title and URL from structured quote without treating hint or IDs as title', () => {
    const text = '协作中的上下文\nhttps://example.org/article\n〔网页标签 tabId=web-1，元素编号这一版 version=v1：要在这一页上做事…〕\n\n[1 链接「首页」]';
    expect(parsePageQuote(text)).toEqual({ title: '协作中的上下文', url: 'https://example.org/article',
      snapshotId: null, reference: false });
  });

  it('recognizes ID-only repeat reference as pointing back to the same page', () => {
    expect(parsePageQuote('〔当前页〕[web:web-1]\n协作中的上下文\nhttps://example.org/article'))
      .toEqual({ title: '协作中的上下文', url: 'https://example.org/article', snapshotId: null, reference: true });
  });

  it('extracts screenshot attachment ID from trailing line', () => {
    const text = withSnapshot('协作中的上下文\nhttps://example.org/article\n\n正文', 'att_123');
    expect(text.endsWith(snapshotMarker('att_123'))).toBe(true);
    expect(parsePageQuote(text)?.snapshotId).toBe('att_123');
  });

  it('ignores non-web quotes (notes, messages, or missing URL)', () => {
    expect(parsePageQuote('一段话\n第二行')).toBeNull();
    expect(parsePageQuote('只有一行')).toBeNull();
    expect(parsePageQuote('标题\nftp://example.org/x')).toBeNull();
  });
});

describe('capturing and uploading page snapshot', () => {
  it('desktop captures visible viewport and uploads it as a web snapshot image attachment', async () => {
    const tool = vi.fn(async () => JPEG);
    window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: {
      sync: () => undefined, navigate: () => undefined, command: () => undefined,
      snapshot: () => Promise.reject(new Error('不读正文')), tools: ['capture'], tool } };
    const fake = createFakeApi({ seed: true, streamStepMs: 0 });
    const view = await capturePageSnapshot(TAB, fake.api.attachments);
    expect(tool).toHaveBeenCalledWith('web-1', { kind: 'capture', scope: 'visible' });
    expect(view?.name).toBe('网页快照 协作中的上下文.jpg');
    expect(view?.mimeType).toBe('image/jpeg');
  });

  it('returns null on web build, non-web tab, or shell without screenshot support', async () => {
    const fake = createFakeApi({ seed: true, streamStepMs: 0 });
    expect(await capturePageSnapshot(TAB, fake.api.attachments)).toBeNull();
    window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: {
      sync: () => undefined, navigate: () => undefined, command: () => undefined,
      snapshot: () => Promise.reject(new Error('不读正文')), tools: ['perceive'],
      tool: async () => JPEG } };
    expect(await capturePageSnapshot(TAB, fake.api.attachments)).toBeNull();
    expect(await capturePageSnapshot({ ...TAB, kind: 'page', url: null }, fake.api.attachments)).toBeNull();
  });

  it('logs screenshot failure and returns null without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: {
      sync: () => undefined, navigate: () => undefined, command: () => undefined,
      snapshot: () => Promise.reject(new Error('不读正文')), tools: ['capture'],
      tool: async () => { throw new Error('标签关了'); } } };
    const fake = createFakeApi({ seed: true, streamStepMs: 0 });
    expect(await capturePageSnapshot(TAB, fake.api.attachments)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
