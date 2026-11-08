// 「问这一页 → 感知并操作整页」（第 3 批）网页这一侧：
// - 引用片：原生会「感知」时带页面结构（大纲 + 带编号的元素），写明网页标签和编号版本，脑按编号操作；不会时照旧带正文。
// - 对话框里列出 Plasticine 在当前标签上做过的步（状态符 + 一句），别的标签的步不出现。

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PagePerception } from '../../../src/api/shared.ts';
import { CurrentTabContext, type CurrentTab } from '../../../src/shell/current-tab-context.ts';
import { ClientStateProvider, createClientState } from '../../../src/state/context.tsx';
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

describe('问这一页的引用片', () => {
  it('带页面结构：标题、网址、标签和编号版本、按编号操作的说法，大纲原样', () => {
    const text = perceptionQuoteText(PERCEPTION, 'tab-race', 10_000);
    expect(text.split('\n').slice(0, 2)).toEqual(['城市马拉松 · 报名', 'https://race.example.cn/signup']);
    expect(text).toContain('tabId=tab-race');
    expect(text).toContain('version=lk3v9a');
    expect(text).toContain('tab_act');
    expect(text).toContain('[8 按钮「提交报名并支付 ¥180」 提交：付款]');
  });

  it('大纲超过上限截断并写明；以图为主的页写明要截图才看得懂', () => {
    const text = perceptionQuoteText({ ...PERCEPTION, outline: '字'.repeat(50), totalChars: 50,
      imageHeavy: true }, 'tab-race', 20);
    expect(text).toContain('只带上了前 20 字');
    expect(text).toContain('以图为主');
  });

  it('原生会感知就带结构，不会就照旧带正文', async () => {
    fakeMac(['find', 'perceive'], PERCEPTION);
    expect((await currentPageQuote(WEB_TAB, null, 10_000)).quote.text).toContain('version=lk3v9a');
    fakeMac(['find'], PERCEPTION);
    expect((await currentPageQuote(WEB_TAB, null, 10_000)).quote.text).toContain('正文');
  });

  it('感知回来的格式不对：退回带正文，不报错', async () => {
    fakeMac(['perceive'], { version: 1 });
    const { quote, failed } = await currentPageQuote(WEB_TAB, null, 10_000);
    expect(failed).toBe(false);
    expect(quote.text).toContain('正文');
  });
});


