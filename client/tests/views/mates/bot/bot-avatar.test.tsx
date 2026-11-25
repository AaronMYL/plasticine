import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BotAvatar } from '../../../../src/views/mates/bot/bot-avatar.tsx';
import { loadBotEngine } from '../../../../src/views/mates/bot/bot-engine.ts';

const fox = { kind: 'mate', character: 'fox', hue: 'indigo', variant: 'solid', face: 'cute' } as const;

function avatar(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('.bot-avatar');
  if (found === null) throw new Error('没有头像');
  return found;
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('Avatar', () => {
  it('idle renders static image of same size without mounting engine', async () => {
    await loadBotEngine();
    const { container } = render(<BotAvatar look={fox} size={28} />);
    const box = avatar(container);
    expect(box.style.width).toBe('28px');
    expect(box.dataset['state']).toBe('idle');
    expect(box.innerHTML).toContain('var(--hue-indigo)');
  });

  it('animates while working and waits to settle before switching back to static on idle', async () => {
    await loadBotEngine();
    const { container, rerender } = render(<BotAvatar look={fox} size={28} state="reading" />);
    await waitFor(() => expect(avatar(container).getAttribute('style')).toContain('--plasticine-fg'));
    expect(avatar(container).querySelector('svg')).not.toBeNull();
    vi.useFakeTimers();
    rerender(<BotAvatar look={fox} size={28} state="idle" />);
    expect(avatar(container).getAttribute('style')).toContain('--plasticine-fg');
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(avatar(container).getAttribute('style')).not.toContain('--plasticine-fg');
    expect(avatar(container).innerHTML).toContain('var(--hue-indigo)');
  });

  it('static-only mode and reduced motion both render a frozen frame without animation', async () => {
    await loadBotEngine();
    const still = render(<BotAvatar look={{ kind: 'main', variant: 'solid' }} size={28} state="failed" still />);
    expect(avatar(still.container).getAttribute('style')).not.toContain('--plasticine-fg');
    expect(avatar(still.container).innerHTML).toContain('var(--accent)');
    still.unmount();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
      matches: query.includes('reduce'), addEventListener: () => undefined, removeEventListener: () => undefined }) });
    const reduced = render(<BotAvatar look={fox} size={28} state="thinking" />);
    expect(avatar(reduced.container).dataset['state']).toBe('thinking');
    expect(avatar(reduced.container).getAttribute('style')).not.toContain('--plasticine-fg');
  });
});
