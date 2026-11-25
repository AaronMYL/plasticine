import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';

const main = (): HTMLElement => screen.getByRole('main');
const GRANTS = 'memdoc-grants';
const seed = (fake: FakeApi): void => fake.control.memoryTopics.seed();

async function open() {
  const app = await renderApp({ hash: '#/memory/topics/memdoc-grants', setup: seed });
  await within(main()).findByRole('region', { name: /^可以直接做/ });
  return app;
}

function row(region: HTMLElement, text: string): HTMLElement {
  return within(region).getByText(text).closest('li')!;
}

async function act(region: HTMLElement, text: string, action: string): Promise<void> {
  fireEvent.click(within(row(region, text)).getByRole('button', { name: /的更多操作$/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: action }));
}

describe('Memory - Promises and authorizations', () => {
  it('shows 4 ordered sections with item counts and scope labels on rows', async () => {
    await open();
    const regions = within(main()).getAllByRole('region').map((region) => region.getAttribute('aria-labelledby'))
      .filter((id) => id !== null);
    expect(regions).toEqual(['grants-allow', 'grants-ask', 'grants-hold', 'grants-promise']);
    const allow = within(main()).getByRole('region', { name: /^可以直接做/ });
    expect(within(allow).getByRole('heading', { level: 2 }).textContent).toBe('可以直接做3');
    expect(within(row(allow, '给周屿发消息不用先问')).getByText('只限 Plasticine 项目')).toBeTruthy();
    expect(within(row(allow, '把信息流里的文章存进资料库')).getByText('点过「以后直接做」')).toBeTruthy();
    const promise = within(main()).getByRole('region', { name: /^答应你的/ });
    expect(within(row(promise, '读完一本书给你一页笔记')).getByRole('img', { name: 'Plasticine 答应的' })).toBeTruthy();
    expect(within(main()).queryByRole('group', { name: '档位' })).toBeNull();
  });

  it('pausing moves item to Paused section and paused item can be restored to Direct', async () => {
    const app = await open();
    await act(within(main()).getByRole('region', { name: /^可以直接做/ }), '定时任务可以自己加，加完告诉你', '先停着');
    const hold = within(main()).getByRole('region', { name: /^先停着/ });
    expect(await within(hold).findByText('定时任务可以自己加，加完告诉你')).toBeTruthy();
    const sections = async () => (await app.api.memoryTopics.get(GRANTS)).sections;
    expect((await sections()).find((section) => section.section === 'hold')?.lines).toHaveLength(2);
    await act(hold, '定时任务可以自己加，加完告诉你', '改成可以直接做');
    const allow = within(main()).getByRole('region', { name: /^可以直接做/ });
    expect(await within(allow).findByText('定时任务可以自己加，加完告诉你')).toBeTruthy();
    expect((await sections()).find((section) => section.section === 'hold')?.lines).toHaveLength(1);
  });

  it('revoking moves item to bottom Revoked section while still visible; restore returns it', async () => {
    const app = await open();
    const ask = within(main()).getByRole('region', { name: /^先问你/ });
    await act(ask, '订阅新的信息源之前先问', '收回');
    await waitFor(() => expect(within(ask).queryByText('订阅新的信息源之前先问')).toBeNull());
    const gone = await within(main()).findByRole('region', { name: '已收回' });
    fireEvent.click(within(gone).getByRole('button', { name: /已收回/ }));
    expect(within(row(gone, '订阅新的信息源之前先问')).getByText('原来在「先问你」')).toBeTruthy();
    expect(await app.api.memoryTopics.withdrawn(GRANTS)).toHaveLength(1);
    fireEvent.click(within(row(gone, '订阅新的信息源之前先问')).getByRole('button', { name: '恢复' }));
    expect(await within(ask).findByText('订阅新的信息源之前先问')).toBeTruthy();
    await waitFor(() => expect(within(main()).queryByRole('region', { name: '已收回' })).toBeNull());
  });

  it('revoking an auto-approved category removes it and decrements directory row count', async () => {
    const app = await open();
    const allow = within(main()).getByRole('region', { name: /^可以直接做/ });
    await act(allow, '把信息流里的文章存进资料库', '收回');
    await waitFor(() => expect(within(allow).queryByText('把信息流里的文章存进资料库')).toBeNull());
    expect((await app.api.memoryTopics.grants()).loop).toEqual([]);
    const list = await app.api.memoryTopics.list();
    expect(list.groups[0]?.topics[0]?.summary).toBe('可以直接做 2 · 先问你 3 · 先停着 1 · 答应你的 2');
  });

  it('adding an item chooses target section first and saves into that section', async () => {
    const app = await open();
    fireEvent.click(within(main()).getByRole('button', { name: '加一条' }));
    const pick = within(main()).getByRole('group', { name: '加到哪一段' });
    expect(within(pick).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['可以直接做', '先问你', '先停着', '答应你的']);
    fireEvent.click(within(pick).getByRole('button', { name: '先问你' }));
    fireEvent.change(within(main()).getByRole('textbox', { name: '加一条记忆' }), { target: { value: '改设置之前先问' } });
    fireEvent.click(within(main()).getByRole('button', { name: '保存' }));
    const ask = within(main()).getByRole('region', { name: /^先问你/ });
    expect(await within(ask).findByText('改设置之前先问')).toBeTruthy();
    const doc = await app.api.memoryTopics.get(GRANTS);
    expect(doc.sections.find((section) => section.section === 'ask')?.lines).toHaveLength(4);
  });
});

describe('Memory - Experience note page', () => {
  it('marks self-learned items with star and source, edited with Previous, no tier, and add by type', async () => {
    await renderApp({ hash: '#/memory/topics/t_how_xhs', setup: seed });
    const avoid = await within(main()).findByRole('region', { name: '要避开的' });
    const changed = row(avoid, '连着打开超过 30 篇会弹验证，隔几分钟再继续。');
    expect(within(changed).getByRole('img', { name: 'Plasticine 自己试出来的' })).toBeTruthy();
    expect(within(changed).getByText('之前：连着打开超过 50 篇会弹验证。')).toBeTruthy();
    expect(within(changed).getByRole('button', { name: '回到原话：整理收藏夹' })).toBeTruthy();
    const how = within(main()).getByRole('region', { name: '做法' });
    const said = row(how, '存进资料库时把封面图一起存，不然列表里只有标题。');
    expect(within(said).queryByRole('img', { name: 'Plasticine 自己试出来的' })).toBeNull();
    expect(within(main()).queryByRole('group', { name: '档位' })).toBeNull();
    fireEvent.click(within(main()).getByRole('button', { name: '加一条' }));
    expect(within(within(main()).getByRole('group', { name: '加到哪一段' })).getAllByRole('button')
      .map((button) => button.textContent)).toEqual(['做法', '要避开的']);
  });

  it('directory shows counts for agreement pages, target for uncertain items, and experience counts', async () => {
    await renderApp({ hash: '#/memory', setup: seed });
    const agreed = await within(main()).findByRole('region', { name: '说好的' });
    expect(within(agreed).getByRole('button', { name: /承诺和授权.*可以直接做 3 · 先问你 3 · 先停着 1 · 答应你的 2/ }))
      .toBeTruthy();
    expect(within(agreed).getByRole('button', { name: /主动告诉你.*每 30 分钟看 7 件事/ })).toBeTruthy();
    const uncertain = within(main()).getByRole('region', { name: '拿不准的' });
    expect(within(uncertain).getByLabelText('打算放进《主动告诉你》')).toBeTruthy();
    const how = within(main()).getByRole('region', { name: '做事经验' });
    expect(within(within(how).getByRole('button', { name: /小红书/ })).getByLabelText('5 条')).toBeTruthy();
    fireEvent.click(within(agreed).getByRole('button', { name: /承诺和授权/ }));
    expect(await within(main()).findByRole('region', { name: /^可以直接做/ })).toBeTruthy();
  });
});
