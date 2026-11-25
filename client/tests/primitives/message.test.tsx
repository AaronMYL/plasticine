import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserMessage } from '../../src/primitives/message/index.tsx';

const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(() => {
  if (clipboard === undefined) {
    Reflect.deleteProperty(navigator, 'clipboard');
  } else {
    Object.defineProperty(navigator, 'clipboard', clipboard);
  }
});

describe('message primitive: user message', () => {
  it('persisted message renders bubble only without status row', () => {
    render(<UserMessage text="今天先做哪件？" quotes={[]} state="sent" />);
    expect(screen.getByText('今天先做哪件？')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('sending state shows Sending label without resend button', () => {
    render(<UserMessage text="一句" quotes={[]} state="sending" onResend={() => undefined} />);
    expect(screen.getByRole('status').textContent).toContain('发送中');
    expect(screen.queryByRole('button', { name: '重发' })).toBeNull();
  });

  it('uncertain receipt shows pending-verification state instead of failure with recheck button', () => {
    const onVerify = vi.fn();
    render(<UserMessage text="一句" quotes={[]} state="uncertain" onVerify={onVerify} onResend={() => undefined} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('结果待核实');
    expect(status.textContent).not.toContain('没发出去');
    expect(screen.queryByRole('button', { name: '重发' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '再核实' }));
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it('verified unsent message allows resending or restoring text to composer', () => {
    const onResend = vi.fn();
    const onDiscard = vi.fn();
    render(<UserMessage text="一句" quotes={[]} state="unsent" onResend={onResend} onDiscard={onDiscard} />);
    expect(screen.getByRole('status').textContent).toContain('没有送到');
    fireEvent.click(screen.getByRole('button', { name: '重发' }));
    fireEvent.click(screen.getByRole('button', { name: '放回输入框' }));
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('explicit failure shows error reason while keeping message text', () => {
    render(<UserMessage text="原话还在" quotes={[]} state="failed" error="服务端拒绝了这一条。" />);
    expect(screen.getByText('原话还在')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('服务端拒绝了这一条。');
  });

  it('message with quote chips lists sources above bubble', () => {
    const quote = { id: 'q1', kind: 'note' as const, sourceId: 'n1', label: '《读书摘记》', text: '一段话' };
    render(<UserMessage text="看看这段" quotes={[quote]} state="sent" />);
    expect(screen.getByText('《读书摘记》')).toBeTruthy();
  });

  it('delivered bubble omits legacy inline copy/quote bar (moved to hover toolbar)', () => {
    render(<UserMessage text="你好" quotes={[]} state="sent" onQuote={() => undefined} />);
    expect(screen.queryByRole('button', { name: '复制消息' })).toBeNull();
    expect(screen.queryByRole('button', { name: '引用这句话' })).toBeNull();
  });

  it('sending or unsent status row keeps copy button preserving newlines, confirms via clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<UserMessage text={'第一行\n第二行'} quotes={[]} state="failed" onResend={() => undefined} />);
    const status = screen.getByRole('status');
    fireEvent.click(within(status).getByRole('button', { name: '复制消息' }));
    expect(writeText).toHaveBeenCalledWith('第一行\n第二行');
    await screen.findByRole('button', { name: '已复制' });
  });

  it('copy failure explains manual copy fallback while keeping message readable', async () => {
    const writeText = vi.fn(async () => { throw new Error('clipboard denied'); });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<UserMessage text="保留这段话" quotes={[]} state="sending" />);
    fireEvent.click(screen.getByRole('button', { name: '复制消息' }));
    expect((await screen.findByRole('alert')).textContent).toContain('手动复制');
    expect(screen.getByText('保留这段话')).toBeTruthy();
  });
});
