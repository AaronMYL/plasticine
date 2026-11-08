// 第 5 批「做还是问」：卡上记着为什么问（推出来的 / 有几种可能 / 资料里没有 / 硬线）。不常显：在「展开依据」里打头，
// 后面接这一张具体为什么现在问；硬线的后果照旧写在卡上和选项底下，不藏进依据。

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AskCard } from '../../src/primitives/ask-card/index.tsx';
import type { AskView } from '../../src/api/types.ts';
import { askView } from '../api/http-fixtures.ts';

function card(ask: AskView) {
  return render(<AskCard ask={ask} ops={[]} drafts={{ answer: '', ask: '' }} onDraft={() => undefined}
    onOption={() => undefined} onText={() => undefined} onDefer={() => undefined} onAskAbout={() => undefined}
    onRetry={() => undefined} onDismiss={() => undefined} />);
}

describe('卡上的依据', () => {
  it('依据不常显；展开依据第一行是依据，后面接为什么现在问', () => {
    card(askView({ basis: 'inferred', why: '你上周说过周报先给组里' }));
    expect(screen.queryByText('推出来的')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开依据' }));
    const basis = screen.getByText('推出来的');
    expect(basis.closest('p')?.textContent).toBe('推出来的你上周说过周报先给组里');
    expect(screen.queryByText(/为什么现在问/)).toBeNull();
  });

  it('只记了依据、别的都没写的卡也能展开看依据；旧卡没有依据照旧写「为什么现在问」', () => {
    const { unmount } = card(askView({ basis: 'hard_line' }));
    fireEvent.click(screen.getByRole('button', { name: '展开依据' }));
    expect(screen.getByText('硬线')).toBeTruthy();
    unmount();
    card(askView({ why: '有一项要你定' }));
    fireEvent.click(screen.getByRole('button', { name: '展开依据' }));
    expect(screen.getByText('为什么现在问：有一项要你定')).toBeTruthy();
  });
});
