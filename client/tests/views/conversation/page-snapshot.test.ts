// 「问这一页」的快照卡（11-13 Aaron 弹框选「快照卡」）：发出去的引用里认得出是一页网页（标题、网址、有没有截图），
// 桌面客户端能截图时截一张传成附件；截不了、传不上都不拦着发。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { capturePageSnapshot, parsePageQuote, snapshotMarker, withSnapshot }
  from '../../../src/views/conversation/page-snapshot.ts';

const TAB = { id: 'web-1', kind: 'web' as const, title: '协作中的上下文', url: 'https://example.org/article', route: null };
const JPEG = { type: 'image/jpeg', base64: btoa('not-a-real-jpeg-but-bytes') };

afterEach(() => { delete window.plasticineDesktop; });

describe('认出一页网页的引用', () => {
  it('带页面结构的：标题、网址；说明那一行和元素编号不算标题', () => {
    const text = '协作中的上下文\nhttps://example.org/article\n〔网页标签 tabId=web-1，元素编号这一版 version=v1：要在这一页上做事…〕\n\n[1 链接「首页」]';
    expect(parsePageQuote(text)).toEqual({ title: '协作中的上下文', url: 'https://example.org/article',
      snapshotId: null, reference: false });
  });

  it('只带标识的（整页发过一遍以后）：也认得出，标成只是指回这一页', () => {
    expect(parsePageQuote('〔当前页〕[web:web-1]\n协作中的上下文\nhttps://example.org/article'))
      .toEqual({ title: '协作中的上下文', url: 'https://example.org/article', snapshotId: null, reference: true });
  });

  it('带截图的：末尾那一行里是附件的标识', () => {
    const text = withSnapshot('协作中的上下文\nhttps://example.org/article\n\n正文', 'att_123');
    expect(text.endsWith(snapshotMarker('att_123'))).toBe(true);
    expect(parsePageQuote(text)?.snapshotId).toBe('att_123');
  });

  it('不是网页的引用（笔记、消息、没有网址）：不认', () => {
    expect(parsePageQuote('一段话\n第二行')).toBeNull();
    expect(parsePageQuote('只有一行')).toBeNull();
    expect(parsePageQuote('标题\nftp://example.org/x')).toBeNull();
  });
});

describe('截一张传上去', () => {
  it('桌面客户端里：截可见的这一屏，传成一份叫「网页快照 …」的图片附件', async () => {
    const tool = vi.fn(async () => JPEG);
    window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: {
      sync: () => undefined, navigate: () => undefined, command: () => undefined, snapshot: () => Promise.reject(new Error('不读正文')), tools: ['capture'], tool } };
    const fake = createFakeApi({ seed: true, streamStepMs: 0 });
    const view = await capturePageSnapshot(TAB, fake.api.attachments);
    expect(tool).toHaveBeenCalledWith('web-1', { kind: 'capture', scope: 'visible' });
    expect(view?.name).toBe('网页快照 协作中的上下文.jpg');
    expect(view?.mimeType).toBe('image/jpeg');
  });

  it('网页版（没有桌面壳）、不是网页标签、壳不会截图：都是 null', async () => {
    const fake = createFakeApi({ seed: true, streamStepMs: 0 });
    expect(await capturePageSnapshot(TAB, fake.api.attachments)).toBeNull();
    window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: {
      sync: () => undefined, navigate: () => undefined, command: () => undefined, snapshot: () => Promise.reject(new Error('不读正文')), tools: ['perceive'],
      tool: async () => JPEG } };
    expect(await capturePageSnapshot(TAB, fake.api.attachments)).toBeNull();
    expect(await capturePageSnapshot({ ...TAB, kind: 'page', url: null }, fake.api.attachments)).toBeNull();
  });

  it('截图出错：记一句，回 null，不往外抛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: {
      sync: () => undefined, navigate: () => undefined, command: () => undefined, snapshot: () => Promise.reject(new Error('不读正文')), tools: ['capture'],
      tool: async () => { throw new Error('标签关了'); } } };
    const fake = createFakeApi({ seed: true, streamStepMs: 0 });
    expect(await capturePageSnapshot(TAB, fake.api.attachments)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
