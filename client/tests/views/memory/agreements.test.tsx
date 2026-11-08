// 记忆页去掉旧版记忆（2026-11-03）：没有「原话与约定」三栏；旧地址 #/memory/board 落到主题目录；引用里的整理前原话只读。
// 第 4 批（11-05）：约定栏换成「怎么替你做事」那份文档；词表也并进去后页头不再有分段。约定表本身不动：引用里指向一条约定
// （#/memory/agreements/<id>，迁进文档的行的出处）时单独读那一条，提议、确认生效、来路、改、撤照旧在那一行上；
// 不再有约定列表和「记一条约定」。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EventsHub } from '../../../src/api/events-hub.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { SignedSender } from '../../../src/views/signing/signed-sender.ts';
import { AgreementStore } from '../../../src/views/memory/agreement-store.ts';
import { NOW, renderApp, settle } from '../../helpers.tsx';

function main(): HTMLElement {
  return screen.getByRole('main');
}

function seed(fake: FakeApi): void {
  fake.control.agreements.seed({ id: 'agr_1', kind: 'term', title: '「接上」', text: '「接上」= 回到上次停下的那一步。',
    migrated: true, awaitingConfirmation: true });
  for (const state of ['active', 'revoked', 'under_review'] as const) {
    fake.control.agreements.seed({ id: `old_${state}`, text: `约定 ${state}`, state, migrated: true,
      userQuote: '按当时的原话保留。', ...(state === 'under_review' ? { effectiveAt: null } : {}) });
  }
}

function row(text: string): HTMLElement {
  return within(within(main()).getByRole('region', { name: '引用的条目' })).getByRole('listitem', { name: text });
}

describe('记忆页没有旧版记忆', () => {
  it('页头没有分段；旧地址 #/memory/board 落到主题目录', async () => {
    await renderApp({ hash: '#/memory/board', setup: (fake) => fake.control.memoryTopics.seed() });
    await settle();
    expect(within(main()).queryByRole('navigation', { name: '记忆视图' })).toBeNull();
    expect(await within(main()).findByRole('region', { name: '关于你和做事方式' })).toBeTruthy();
    expect(screen.queryByText('原话与约定')).toBeNull();
    expect(within(main()).queryByRole('region', { name: '原话' })).toBeNull();
    expect(within(main()).queryByRole('region', { name: '解释' })).toBeNull();
  });

  it('引用里指向一条整理前的原话：只读，没有改、删、标过时', async () => {
    await renderApp({ hash: '#/memory/entries/mem_q', setup: (fake) => {
      fake.control.memory.seed({ id: 'mem_q', kind: 'quote', text: '以后对账先给我看差异。' });
    } });
    const quote = await within(main()).findByText('以后对账先给我看差异。');
    expect(quote).toBeTruthy();
    expect(within(main()).getByText(/整理进主题记忆之前的一条原话（只读）/)).toBeTruthy();
    for (const name of ['改', '删', '标过时', '对', '不对']) {
      expect(within(main()).queryByRole('button', { name })).toBeNull();
    }
  });
});

describe('引用里的一条约定（#/memory/agreements/<id>）', () => {
  for (const [state, label] of [['active', '生效'], ['revoked', '已撤'], ['under_review', '待议']] as const) {
    it(`${label}的约定保留真实状态，来源历史可展开且不会替用户确认`, async () => {
      const app = await renderApp({ hash: `#/memory/agreements/old_${state}`, setup: seed });
      const agreement = await waitFor(() => row(`约定 ${state}`));
      expect(within(agreement).getByText(label, { selector: '.tag' })).toBeTruthy();
      expect(agreement.textContent).toContain('按当时的原话保留。');
      expect(within(agreement).queryByRole('button', { name: '确认生效' }) !== null).toBe(state === 'under_review');
      const before = await app.api.agreements.get(`old_${state}`);
      fireEvent.click(within(agreement).getByRole('button', { name: /的更多操作$/ }));
      fireEvent.click(screen.getByRole('menuitem', { name: '上下文与版本来路' }));
      const lineage = await within(agreement).findByRole('list', { name: '约定版本来路' });
      expect(lineage.textContent).toContain('迁移');
      expect(lineage.textContent).not.toContain('设备确认');
      expect(await app.api.agreements.get(`old_${state}`)).toEqual(before);
    });
  }

  it('词语约定待你回答；已配对会话直接确认后「待你确认」去掉', async () => {
    const app = await renderApp({ hash: '#/memory/agreements/agr_1', setup: seed });
    const send = vi.spyOn(app.api.signed, 'send');
    const term = await waitFor(() => row('「接上」'));
    expect(term.textContent).toContain('词语约定');
    expect(term.textContent).toContain('有一项待你回答');
    fireEvent.click(within(term).getByRole('button', { name: '确认生效' }));
    await waitFor(() => expect(row('「接上」').textContent).not.toContain('有一项待你回答'));
    expect(send.mock.calls[0]?.[0]).toMatchObject({ target: { kind: 'agreement_confirm', agreementId: 'agr_1' } });
    expect(app.control.agreements.find('agr_1')).toMatchObject({ awaitingConfirmation: false, state: 'active' });
  });

  it('只读那一条：下面没有约定列表，也没有「记一条约定」', async () => {
    await renderApp({ hash: '#/memory/agreements/old_active', setup: seed });
    const focus = await within(main()).findByRole('region', { name: '引用的条目' });
    expect(focus.textContent).toContain('约定 active');
    expect(within(main()).queryByRole('region', { name: '约定' })).toBeNull();
    expect(within(main()).queryByRole('button', { name: '记一条' })).toBeNull();
  });

  it('约定的「确认生效」常显；在对话里提 / 来路 / 改 / 撤收在行尾 ⋯（2026-11-04 第 2 批；2026-11-05 手机上没有记忆）', async () => {
    await renderApp({ hash: '#/memory/agreements/agr_1', width: 1440, setup: seed });
    const agreement = await waitFor(() => row('「接上」'));
    expect(within(agreement).getByRole('button', { name: '确认生效' })).toBeTruthy();
    expect(within(agreement).queryByRole('button', { name: '撤回' })).toBeNull();
    fireEvent.click(within(agreement).getByRole('button', { name: /的更多操作$/ }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent))
      .toEqual(['在对话里提', '上下文与版本来路', '修改', '撤回']);
  });
});

describe('约定的数据', () => {
  function store() {
    const fake = createFakeApi({ seed: false, now: () => NOW, streamStepMs: 0 });
    fake.control.session.signInForDevelopment('测试机');
    const hub = new EventsHub(fake.api.events);
    const signer = { send: vi.fn() } as unknown as SignedSender;
    return { fake, hub, agreements: new AgreementStore(fake.api, hub, signer) };
  }

  it('已翻过的第二页在快照重载后还能再读入，停止中的分页不会锁住下一次翻页', async () => {
    const { fake, agreements } = store();
    for (let i = 0; i < 101; i += 1) {
      fake.control.agreements.seed({ id: `a${i}`, text: `约定 ${i}` });
    }
    agreements.start();
    await agreements.reload();
    await agreements.more();
    await agreements.reload();
    await agreements.more();
    expect(agreements.data.get().agreements.items).toHaveLength(100);
    const snapshot = await fake.api.agreements.list({ offset: 100 });
    const gate = Promise.withResolvers<typeof snapshot>();
    vi.spyOn(fake.api.agreements, 'list').mockReturnValueOnce(gate.promise);
    const reading = agreements.more();
    agreements.stop();
    agreements.start();
    await agreements.more();
    expect(agreements.data.get().agreements.items).toHaveLength(101);
    gate.resolve(snapshot);
    await reading;
    agreements.stop();
  });

  it('加载期间到的 agreement.changed：快照装好后那条约定换成新的', async () => {
    const { fake, hub, agreements } = store();
    fake.control.agreements.seed({ id: 'agr_1', text: '先给结论' });
    agreements.start();
    hub.start();
    const list = fake.api.agreements.list.bind(fake.api.agreements);
    let release: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(fake.api.agreements, 'list').mockImplementationOnce(async (query) => {
      const snapshot = await list(query);
      await opened;
      return snapshot;
    });
    const loading = agreements.reload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    act(() => {
      fake.control.agreements.changeElsewhere('agr_1', { text: '先给结论，再给依据' });
    });
    release();
    await loading;
    await vi.waitFor(() => expect(agreements.data.get().agreements.items[0]?.text).toBe('先给结论，再给依据'));
    agreements.stop();
    hub.stop();
  });
});
