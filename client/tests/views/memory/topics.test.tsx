// 记忆页改成「主题目录 + 拿不准的」（2026-11-02 第 102 条）：目录按 关于你 · 人 · 项目 · 话题，每个主题一句话；
// 拿不准的最多摆 3 条，对 / 不对 / 改一句（用户确认字段，本人会话确认）；点开一份是活文档，每行链回原话。
// 第 4 批（11-04）：约定栏换成「主线的 Soul」，和「关于你」排在目录最前面一组（不写组名），旧地址 #/memory/agreements 打开它。
// 11-05：词表撤掉、并进「主线的 Soul」，页头的分段整个去掉（记忆页直接是文档目录）；旧地址 #/memory/terms 打开它。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { ApiError, NOT_RECEIVED_CODE } from '../../../src/api/errors.ts';
import { renderApp } from '../../helpers.tsx';

function seed(fake: FakeApi): void {
  fake.control.memoryTopics.seed();
}

function main(): HTMLElement {
  return screen.getByRole('main');
}

describe('记忆 · 主题目录', () => {
  it('默认是主题目录（设计稿 11-06）：昨晚整理的入口、拿不准的（最多 3 条），再按 关于你和做事方式 · 项目 · 人 · 话题 · 技能 分组',
    async () => {
      await renderApp({ hash: '#/memory', setup: seed });
      expect(within(main()).getByRole('heading', { level: 1, name: '记忆' })).toBeTruthy();
      expect(within(main()).queryByRole('navigation', { name: '记忆视图' })).toBeNull();
      expect(within(main()).getByRole('searchbox', { name: '搜记忆，含归档' })).toBeTruthy();
      expect(await within(main()).findByRole('button', { name: /昨晚整理了 12 条.*新加 7 · 替换 3 · 拿不准 1/ }))
        .toBeTruthy();
      const uncertain = within(main()).getByRole('region', { name: '拿不准的' });
      expect(within(uncertain).getAllByRole('button', { name: '没错' }).length).toBeLessThanOrEqual(3);
      const regions = within(main()).getAllByRole('region').map((region) => region.getAttribute('aria-labelledby'));
      expect(regions).toEqual(['memory-uncertain', 'topics-about_you', 'topics-project', 'topics-person',
        'topics-topic', 'topics-skill']);
      const pinned = within(main()).getByRole('region', { name: '关于你和做事方式' });
      expect(within(pinned).getAllByRole('button').map((button) => button.textContent?.split(/身份|你明说/)[0]))
        .toEqual(['关于你', '主线的 Soul']);
      expect(within(main()).getByRole('button', { name: /周屿.*Cyber Hunter 的合作者/ })).toBeTruthy();
    });

  it('档位只在不是私密时标出来；超出上限的那篇标出来', async () => {
    await renderApp({ hash: '#/memory', setup: seed });
    const projects = await within(main()).findByRole('region', { name: '项目' });
    const hunter = within(projects).getByRole('button', { name: /Cyber Hunter/ });
    expect(within(hunter).getByText('公开')).toBeTruthy();
    const personal = within(projects).getByRole('button', { name: /个人/ });
    expect(within(personal).queryByLabelText(/^档位：/)).toBeNull();
    const skills = within(main()).getByRole('region', { name: '技能' });
    expect(within(skills).getByText('超出上限')).toBeTruthy();
  });

  it('还没有夜里的整理：入口整行不出现', async () => {
    await renderApp({ hash: '#/memory', setup: (fake) => {
      seed(fake);
      fake.control.memoryTopics.clearDream();
    } });
    await within(main()).findByRole('region', { name: '拿不准的' });
    expect(within(main()).queryByRole('button', { name: /昨晚整理了/ })).toBeNull();
  });

  it('搜记忆含归档：有字时主区换成结果，归档里的旧说法标「归档」，点一行打开那一篇', async () => {
    await renderApp({ hash: '#/memory', setup: seed });
    fireEvent.change(await within(main()).findByRole('searchbox', { name: '搜记忆，含归档' }),
      { target: { value: '研究周报' } });
    const results = await within(main()).findByRole('list', { name: '搜到的记忆' });
    const old = within(results).getByRole('button', { name: /研究周报每周五晚上发/ });
    expect(within(old).getByText('归档')).toBeTruthy();
    expect(within(main()).queryByRole('region', { name: '拿不准的' })).toBeNull();
    fireEvent.click(old);
    await waitFor(() => expect(window.location.hash).toBe('#/memory/topics/t_you'));
  });

  it('拿不准的点「对」按本人会话确认：发出后，收成一行「已记进《关于你》」，服务端记下', async () => {
    const app = await renderApp({ hash: '#/memory', setup: seed });
    const send = vi.spyOn(app.api.signed, 'send');
    const uncertain = await within(main()).findByRole('region', { name: '拿不准的' });
    fireEvent.click(within(uncertain).getAllByRole('button', { name: '没错' })[0]!);
    expect(await within(uncertain).findByText('已记进《关于你》', {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(async () => expect((await app.api.memoryTopics.list()).uncertain).toHaveLength(2));
    expect(send.mock.calls[0]?.[0]).toMatchObject({ target: { kind: 'memory_uncertain' } });
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('signature');
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('signedAt');
  });

  it('确认没送到：那一条放回原样，就地一行「没有送到」给「重发」；重发成功再收起来', async () => {
    const app = await renderApp({ hash: '#/memory', setup: seed });
    const uncertain = await within(main()).findByRole('region', { name: '拿不准的' });
    const real = app.api.signed.send.bind(app.api.signed);
    const restarting = new ApiError({ kind: 'failed', code: NOT_RECEIVED_CODE, status: 503,
      message: '服务正在重启，这一步没有执行。' });
    vi.spyOn(app.api.signed, 'send').mockRejectedValueOnce(restarting).mockImplementation(real);
    fireEvent.click(within(uncertain).getAllByRole('button', { name: '没错' })[0]!);
    expect(await within(uncertain).findByText(/没有送到/)).toBeTruthy();
    expect(within(uncertain).getAllByRole('button', { name: '没错' })).toHaveLength(3);
    fireEvent.click(within(uncertain).getByRole('button', { name: '重发' }));
    expect(await within(uncertain).findByText('已记进《关于你》', {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(async () => expect((await app.api.memoryTopics.list()).uncertain).toHaveLength(2));
  });

  it('点开一个主题是活文档：小节、每行右边链回原话；推断和拿不准的行有小签', async () => {
    await renderApp({ hash: '#/memory', setup: seed });
    fireEvent.click(await within(main()).findByRole('button', { name: /关于你.*身份、住处/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/memory/topics/t_you'));
    expect(await within(main()).findByRole('heading', { level: 1, name: '关于你' })).toBeTruthy();
    expect(within(main()).getByRole('region', { name: '作息' })).toBeTruthy();
    expect(within(main()).getAllByRole('button', { name: /^回到原话：/ }).length).toBeGreaterThan(5);
    const commute = within(main()).getByText(/早上 8:30–9:10 是通勤/).closest('li') as HTMLElement;
    expect(within(commute).getByText('推断')).toBeTruthy();
    expect(within(commute).getByText('拿不准')).toBeTruthy();
    fireEvent.click(within(main()).getByRole('button', { name: '‹ 记忆目录' }));
    await waitFor(() => expect(window.location.hash).toBe('#/memory'));
  });

  it('项目那页就是项目档案：顶上「打开项目」到项目页', async () => {
    await renderApp({ hash: '#/memory/topics/t_hunter', setup: seed });
    fireEvent.click(await within(main()).findByRole('button', { name: '打开项目' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects/project_hunter'));
  });

  it('「主线的 Soul」：最前面是硬线（带锁、ⓘ 说明），下面是规矩，迁来的行出处是约定；旧地址 #/memory/agreements 打开它',
    async () => {
      await renderApp({ hash: '#/memory/agreements', setup: seed });
      expect(await within(main()).findByRole('heading', { level: 1, name: '主线的 Soul' })).toBeTruthy();
      const hard = within(main()).getByRole('region', { name: /^先问你/ });
      expect(within(hard).getAllByRole('listitem').map((item) => item.textContent))
        .toEqual(['花钱', '以本人名义对外答应或发出', '删除和其他做了就撤不回的', '权限变化', '必须本人做的']);
      expect(within(hard).getByRole('button', { name: '先问你的说明' }).getAttribute('aria-description'))
        .toMatch(/不管有没有把握/);
      const rules = within(main()).getByRole('region', { name: '规矩' });
      const migrated = within(rules).getByText(/要你定的事一律给选项/).closest('li') as HTMLElement;
      expect(within(migrated).queryByText('约定', { selector: '.tag' })).toBeNull();
      expect(within(migrated).getByRole('button', { name: '回到原话：约定' })).toBeTruthy();
      expect(within(main()).queryByRole('navigation', { name: '记忆视图' })).toBeNull();
    });

  it('词表撤掉（11-05）：旧地址 #/memory/terms 打开「主线的 Soul」；迁来的词义行出处写「词表」，点过去读原来那一条',
    async () => {
      await renderApp({ hash: '#/memory/terms', setup: seed });
      expect(await within(main()).findByRole('heading', { level: 1, name: '主线的 Soul' })).toBeTruthy();
      const rules = within(main()).getByRole('region', { name: '规矩' });
      const term = within(rules).getByText(/「接上」指的是/).closest('li') as HTMLElement;
      fireEvent.click(within(term).getByRole('button', { name: '回到原话：词表' }));
      await waitFor(() => expect(window.location.hash).toMatch(/^#\/memory\/agreements\//));
    });

  it('带 id 的旧词表链接 #/memory/terms/<id> 单独读那一条（只读引用页，不再有词表编辑）', async () => {
    await renderApp({ hash: '#/memory/terms/agr_term', setup: (fake) => {
      fake.control.agreements.seed({ id: 'agr_term', kind: 'term', title: '接上', text: '回到上次停下的那一步。' });
    } });
    const focus = await within(main()).findByRole('region', { name: '引用的条目' });
    expect(await within(focus).findByText(/回到上次停下的那一步/)).toBeTruthy();
    expect(within(main()).queryByRole('region', { name: '词表' })).toBeNull();
    expect(within(main()).queryByRole('button', { name: '词语版本与编辑' })).toBeNull();
  });

  it('文档里的 [[名字]] 是双链：点了打开那一篇；页头能改档位，改了目录上的小签跟着变', async () => {
    const app = await renderApp({ hash: '#/memory/topics/t_hunter', setup: seed });
    const mark = vi.spyOn(app.api.visibility, 'mark');
    const tiers = await within(main()).findByRole('group', { name: '档位' });
    expect(within(tiers).getByRole('button', { name: '公开' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(tiers).getByRole('button', { name: '朋友' }));
    await waitFor(() => expect(within(tiers).getByRole('button', { name: '朋友' }).getAttribute('aria-pressed'))
      .toBe('true'));
    expect(mark.mock.calls[0]?.[0]).toMatchObject({ kind: 'project', id: 'project_hunter', tier: 'friend' });
    fireEvent.click(within(main()).getByRole('button', { name: '周屿' }));
    await waitFor(() => expect(window.location.hash).toBe('#/memory/topics/t_zhouyu'));
    expect(await within(main()).findByRole('heading', { level: 1, name: '周屿' })).toBeTruthy();
  });
});

describe('记忆 · 昨晚整理了什么', () => {
  it('从入口进来：新加 / 替换 / 拿不准 / 走不通的路各一段，先摆 3 条，其余收着；替换的旧说法划掉', async () => {
    await renderApp({ hash: '#/memory', setup: seed });
    fireEvent.click(await within(main()).findByRole('button', { name: /昨晚整理了 12 条/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/memory/dream'));
    expect(await within(main()).findByRole('heading', { level: 1, name: '昨晚整理了 12 条' })).toBeTruthy();
    expect(within(main()).getByText(/读了 6 条线、43 段对话/)).toBeTruthy();
    const added = within(main()).getByRole('region', { name: '新加' });
    expect(within(added).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(added).getByRole('button', { name: /其余 4 条/ }));
    expect(within(added).getAllByRole('listitem')).toHaveLength(7);
    const replaced = within(main()).getByRole('region', { name: '替换' });
    expect(within(replaced).getByText('重要的事再发一封邮件兜底（11月1日）')).toBeTruthy();
    expect(within(main()).getByRole('region', { name: '走不通的路' })).toBeTruthy();
  });

  it('撤销一条：那一行划掉、写「已撤销」，不再给撤销；拿不准的挑一个，写「定了」', async () => {
    await renderApp({ hash: '#/memory/dream', setup: seed });
    const added = await within(main()).findByRole('region', { name: '新加' });
    fireEvent.click(within(added).getByRole('button', { name: /^撤销「Plasticine 的侧栏/ }));
    const row = (await within(added).findByText('已撤销')).closest('li') as HTMLElement;
    expect(row.getAttribute('data-undone')).toBe('true');
    expect(within(row).queryByRole('button', { name: /^撤销/ })).toBeNull();
    const unsure = within(main()).getByRole('region', { name: '拿不准' });
    fireEvent.click(within(unsure).getByRole('button', { name: '网站' }));
    expect(await within(unsure).findByText('定了：网站')).toBeTruthy();
  });
});
