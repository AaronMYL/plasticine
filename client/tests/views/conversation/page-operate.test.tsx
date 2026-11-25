import { afterEach, describe, expect, it } from 'vitest';
import type { PagePerception } from '../../../src/api/shared.ts';
import { type CurrentTab } from '../../../src/shell/current-tab-context.ts';
import { currentPageQuote, perceptionQuoteText } from '../../../src/views/conversation/ask-this-page.tsx';

const PERCEPTION: PagePerception = {
  version: 'lk3v9a', url: 'https://race.example.cn/signup', title: '城市马拉松 · 报名',
  outline: '# 填写报名信息\n[1 输入框「姓名」 = Alex]\n[8 按钮「提交报名并支付 ¥180」 提交：付款]',
  totalChars: 64, truncated: false, imageHeavy: false, digest: 'abc',
  elements: [{ n: 1, role: 'textbox', name: '姓名', value: 'Alex' },
    { n: 8, role: 'button', name: '提交报名并支付 ¥180', submit: 'pay' }],
};

const WEB_TAB: CurrentTab = { id: 'tab-race', kind: 'web', title: '城市马拉松 · 报名', route: null,
  url: 'https://race.example.cn/signup' };

afterEach(() => {
  delete window.plasticineDesktop;
});

function fakeMac(tools: string[], perception: unknown): void {
  window.plasticineDesktop = { version: '0.6.0', notify: () => undefined, webTabs: { sync: () => undefined,
    command: () => undefined, navigate: () => undefined,
    snapshot: (tabId: string) => Promise.resolve({ tabId, url: WEB_TAB.url, title: WEB_TAB.title, text: '正文',
      totalChars: 2, truncated: false }),
    tools, tool: () => Promise.resolve(perception) } };
}

describe('ask-this-page quote chip', () => {
  it('includes page structure: title, URL, tab/version, element-action note, and raw outline', () => {
    const text = perceptionQuoteText(PERCEPTION, 'tab-race', 10_000);
    expect(text.split('\n').slice(0, 2)).toEqual(['城市马拉松 · 报名', 'https://race.example.cn/signup']);
    expect(text).toContain('tabId=tab-race');
    expect(text).toContain('version=lk3v9a');
    expect(text).toContain('tab_act');
    expect(text).toContain('[8 按钮「提交报名并支付 ¥180」 提交：付款]');
  });

  it('truncates oversized outline with notice and flags image-heavy pages as needing screenshot', () => {
    const text = perceptionQuoteText({ ...PERCEPTION, outline: '字'.repeat(50), totalChars: 50,
      imageHeavy: true }, 'tab-race', 20);
    expect(text).toContain('只带上了前 20 字');
    expect(text).toContain('以图为主');
  });

  it('attaches structure when native supports perception, else falls back to body text', async () => {
    fakeMac(['find', 'perceive'], PERCEPTION);
    expect((await currentPageQuote(WEB_TAB, null, 10_000)).quote.text).toContain('version=lk3v9a');
    fakeMac(['find'], PERCEPTION);
    expect((await currentPageQuote(WEB_TAB, null, 10_000)).quote.text).toContain('正文');
  });

  it('malformed perception payload falls back to body text without throwing', async () => {
    fakeMac(['perceive'], { version: 1 });
    const { quote, failed } = await currentPageQuote(WEB_TAB, null, 10_000);
    expect(failed).toBe(false);
    expect(quote.text).toContain('正文');
  });
});

