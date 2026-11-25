import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LETTER_BRIEF } from '../../../src/api/shared.ts';
import { MAIN_LINE_ID } from '../../../src/api/fake/fake-lines.ts';
import { mainLineBrief } from '../../../src/views/settings/push-switch.ts';
import { NOW, renderApp } from '../../helpers.tsx';

describe('Letter card', () => {
  it('renders one-liner plus letter card linking to that letter', async () => {
    await renderApp({ hash: '#/plasticine', setup: (fake) => {
      fake.control.spaces.seed();
      fake.control.lines.record(MAIN_LINE_ID, { role: 'letter', text: '给你写了一封信：你定的「做梦」有了一组数字。',
        thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null, say: null, ok: null, summary: null,
        stopReason: null, childLineId: null, attachments: [], widgets: [],
        letter: { spaceId: 'sp_letter_dream', title: '做梦，有了一组数字' }, createdAt: NOW.toISOString() });
    } });
    expect(await screen.findByText('给你写了一封信：你定的「做梦」有了一组数字。')).toBeTruthy();
    const card = screen.getByRole('link', { name: '来信：做梦，有了一组数字' });
    expect(card.getAttribute('href')).toBe('#/books/space/sp_letter_dream');
    expect(within(card).getByText('来信')).toBeTruthy();
    expect(card.querySelector('.space-thumb')).not.toBeNull();
  });

  it('Mac notification for letter shows only Wrote you a letter', () => {
    expect(mainLineBrief({ role: 'letter', text: '给你写了一封信：……' } as never)).toBe(LETTER_BRIEF);
    expect(LETTER_BRIEF).toBe('Plasticine 给你写了一封信');
  });
});
