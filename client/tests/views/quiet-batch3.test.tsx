import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, settle } from '../helpers.tsx';

describe('Omits status line when project has no status', () => {
  it('does not render No status yet placeholder in list', async () => {
    await renderApp({ hash: '#/projects', setup: (fake) => {
      fake.control.projects.seed({ id: 'p_empty', name: '空项目' });
    } });
    await settle();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /空项目/ }).length).toBeGreaterThan(0));
    expect(screen.queryByText('还没有现状')).toBeNull();
  });
});
