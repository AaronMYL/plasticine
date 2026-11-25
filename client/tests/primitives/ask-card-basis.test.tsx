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

describe('evidence on cards', () => {
  it('evidence is hidden by default; expanding shows evidence first then why-now explanation', () => {
    card(askView({ basis: 'inferred', why: '你上周说过周报先给组里' }));
    expect(screen.queryByText('推出来的')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开依据' }));
    const basis = screen.getByText('推出来的');
    expect(basis.closest('p')?.textContent).toBe('推出来的你上周说过周报先给组里');
    expect(screen.queryByText(/为什么现在问/)).toBeNull();
  });

  it('evidence-only card can still expand; legacy card without evidence keeps why-now label', () => {
    const { unmount } = card(askView({ basis: 'hard_line' }));
    fireEvent.click(screen.getByRole('button', { name: '展开依据' }));
    expect(screen.getByText('硬线')).toBeTruthy();
    unmount();
    card(askView({ why: '有一项要你定' }));
    fireEvent.click(screen.getByRole('button', { name: '展开依据' }));
    expect(screen.getByText('为什么现在问：有一项要你定')).toBeTruthy();
  });
});
