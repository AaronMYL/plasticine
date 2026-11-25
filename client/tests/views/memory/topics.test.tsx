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

describe('Memory - Topic directory', () => {
  it('defaults to topic directory with last night entry, up to 3 uncertain, and grouped sections',
    async () => {
      await renderApp({ hash: '#/memory', setup: seed });
      expect(within(main()).getByRole('heading', { level: 1, name: '记忆' })).toBeTruthy();
      expect(within(main()).queryByRole('navigation', { name: '记忆视图' })).toBeNull();
      expect(within(main()).getByRole('searchbox', { name: '搜记忆，含归档' })).toBeTruthy();
      expect(await within(main()).findByRole('button', { name: /昨晚整理了 12 条.*新加 7 · 替换 3 · 拿不准 1/ }))
        .toBeTruthy();
      const uncertain = within(main()).getByRole('region', { name: '拿不准的' });
      expect(within(uncertain).getAllByRole('button', { name: '没错' }).length).toBeLessThanOrEqual(3);
      expect(within(main()).getByRole('region', { name: '总览' })).toBeTruthy();
      const regions = within(main()).getAllByRole('region').map((region) => region.getAttribute('aria-labelledby'))
        .filter((id) => id !== null);
      expect(regions).toEqual(['memory-uncertain', 'topics-grants', 'topics-about_you', 'topics-person',
        'topics-project', 'topics-topic', 'topics-how']);
      const pinned = within(main()).getByRole('region', { name: '你' });
      expect(within(pinned).getAllByRole('button').map((button) => button.textContent?.split(/身份|你明说/)[0]))
        .toEqual(['关于你']);
      expect(within(main()).getByRole('button', { name: /周屿.*Cyber Hunter 的合作者/ })).toBeTruthy();
    });

  it('shows tier badge only when non-private and flags pages exceeding limit', async () => {
    await renderApp({ hash: '#/memory', setup: seed });
    const projects = await within(main()).findByRole('region', { name: '项目' });
    const hunter = within(projects).getByRole('button', { name: /Cyber Hunter/ });
    expect(within(hunter).getByText('公开')).toBeTruthy();
    const personal = within(projects).getByRole('button', { name: /个人/ });
    expect(within(personal).queryByLabelText(/^档位：/)).toBeNull();
    const skills = within(main()).getByRole('region', { name: '其他' });
    expect(within(skills).getByText('超出上限')).toBeTruthy();
  });

  it('hides overnight summary row when no overnight curation exists', async () => {
    await renderApp({ hash: '#/memory', setup: (fake) => {
      seed(fake);
      fake.control.memoryTopics.clearDream();
    } });
    await within(main()).findByRole('region', { name: '拿不准的' });
    expect(within(main()).queryByRole('button', { name: /昨晚整理了/ })).toBeNull();
  });

  it('memory search includes archived items tagged Archived and opens page on click', async () => {
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

  it('confirming uncertain item as correct records via self session and collapses to Saved', async () => {
    const app = await renderApp({ hash: '#/memory', setup: seed });
    const send = vi.spyOn(app.api.signed, 'send');
    const uncertain = await within(main()).findByRole('region', { name: '拿不准的' });
    fireEvent.click(within(uncertain).getAllByRole('button', { name: '没错' })[0]!);
    expect(await within(uncertain).findByText('已记进《主动告诉你》', {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(async () => expect((await app.api.memoryTopics.list()).uncertain).toHaveLength(2));
    expect(send.mock.calls[0]?.[0]).toMatchObject({ target: { kind: 'memory_uncertain' } });
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('signature');
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('signedAt');
  });

  it('failed confirmation restores item with inline Not delivered and Resend that collapses on retry', async () => {
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
    expect(await within(uncertain).findByText('已记进《主动告诉你》', {}, { timeout: 3000 })).toBeTruthy();
    await waitFor(async () => expect((await app.api.memoryTopics.list()).uncertain).toHaveLength(2));
  });

  it('opening a topic shows living document with sections, source links, and inferred/uncertain tags', async () => {
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

  it('project memory page acts as project dossier with Open project link at top', async () => {
    await renderApp({ hash: '#/memory/topics/t_hunter', setup: seed });
    fireEvent.click(await within(main()).findByRole('button', { name: '打开项目' }));
    await waitFor(() => expect(window.location.hash).toBe('#/projects/project_hunter'));
  });

  it('legacy #/memory/agreements and #/memory/terms open rule migration; hard-lines moved to Settings', async () => {
    await renderApp({ hash: '#/memory/agreements', setup: seed });
    expect(await within(main()).findByRole('heading', { level: 1, name: '规则搬家' })).toBeTruthy();
    window.location.hash = '#/memory/terms';
    expect(await within(main()).findByRole('heading', { level: 1, name: '规则搬家' })).toBeTruthy();
    window.location.hash = '#/settings/grants';
    const dialog = await screen.findByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '隐私与授权' }));
    const hard = await within(dialog).findByRole('region', { name: '先问你' });
    expect(within(hard).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['花钱', '以本人名义对外答应或发出', '删除和其他做了就撤不回的', '权限变化', '必须本人做的']);
    expect(within(hard).getByRole('button', { name: '先问你的说明' }).getAttribute('aria-description'))
      .toMatch(/不管有没有把握/);
  });

  it('legacy agreement and term ID routes also redirect to retired rule migration page', async () => {
    await renderApp({ hash: '#/memory/terms/agr_term', setup: seed });
    expect(await within(main()).findByRole('heading', { level: 1, name: '规则搬家' })).toBeTruthy();
    window.location.hash = '#/memory/agreements/agr_1';
    expect(await within(main()).findByRole('heading', { level: 1, name: '规则搬家' })).toBeTruthy();
    expect(within(main()).queryByRole('region', { name: '引用的条目' })).toBeNull();
  });

  it('wikilinks [[name]] open target page and header tier change updates directory badge', async () => {
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

describe('Memory - What was curated last night', () => {
  it('groups added, replaced, uncertain, and dead-end showing 3 each with replaced struck through', async () => {
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

  it('undoing strikes through item as Undone without re-undo; picking uncertain marks Decided', async () => {
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
