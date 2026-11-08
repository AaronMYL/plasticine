import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMessage } from './index.tsx';

const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (clipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', clipboard);
  }
});

describe('消息原语 · 你的话', () => {
  it('已存下的一条只有气泡，没有状态行', () => {
    render(<UserMessage text="今天先做哪件？" quotes={[]} state="sent" />);
    expect(screen.getByText('今天先做哪件？')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('发送中写「发送中」，不给重发', () => {
    render(<UserMessage text="一句" quotes={[]} state="sending" onResend={() => undefined} />);
    expect(screen.getByRole('status').textContent).toContain('发送中');
    expect(screen.queryByRole('button', { name: '重发' })).toBeNull();
  });

  it('回执不确定时写「结果待核实」而不是失败，点「再核实」去查', () => {
    const onVerify = vi.fn();
    render(<UserMessage text="一句" quotes={[]} state="uncertain" onVerify={onVerify} onResend={() => undefined} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('结果待核实');
    expect(status.textContent).not.toContain('没发出去');
    expect(screen.queryByRole('button', { name: '重发' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再核实' }));
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it('核实过没送到：可以重发，也可以把字放回输入框', () => {
    const onResend = vi.fn();
    const onDiscard = vi.fn();
    render(<UserMessage text="一句" quotes={[]} state="unsent" onResend={onResend} onDiscard={onDiscard} />);
    expect(screen.getByRole('status').textContent).toContain('没有送到');
    fireEvent.click(screen.getByRole('button', { name: '重发' }));
    fireEvent.click(screen.getByRole('button', { name: '放回输入框' }));
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('明确失败写原因，字还在', () => {
    render(<UserMessage text="原话还在" quotes={[]} state="failed" error="服务端拒绝了这一条。" />);
    expect(screen.getByText('原话还在')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('服务端拒绝了这一条。');
  });

  it('带引用片时气泡上方列出来源', () => {
    const quote = { id: 'q1', kind: 'note' as const, sourceId: 'n1', label: '《读书摘记》', text: '一段话' };
    render(<UserMessage text="看看这段" quotes={[quote]} state="sent" />);
    expect(screen.getByText('《读书摘记》')).toBeTruthy();
  });

  it('送到了的那句气泡旁边没有旧的复制、引用一排（复制、回复在对话的悬停条里）', () => {
    render(<UserMessage text="你好" quotes={[]} state="sent" onQuote={() => undefined} />);
    expect(screen.queryByRole('button', { name: '复制消息' })).toBeNull();
    expect(screen.queryByRole('button', { name: '引用这句话' })).toBeNull();
  });

  it('发送中、没送到的那句状态行尾留一个复制：保留原文与换行，得到剪贴板回执后才显示已复制', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<UserMessage text={'第一行\n第二行'} quotes={[]} state="failed" onResend={() => undefined} />);
    const status = screen.getByRole('status');
    fireEvent.click(within(status).getByRole('button', { name: '复制消息' }));
    expect(writeText).toHaveBeenCalledWith('第一行\n第二行');
    await screen.findByRole('button', { name: '已复制' });
  });

  it('复制失败说明手动复制路径，原消息仍可读', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied'); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<UserMessage text="保留这段话" quotes={[]} state="sending" />);
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }));
    expect((await screen.findByRole('alert')).textContent).toContain('手动复制');
    expect(screen.getByText('保留这段话')).toBeTruthy();
  });
});
