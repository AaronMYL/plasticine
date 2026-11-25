import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../src/api/context.tsx';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import { SiteIcon } from '../../src/shell/site-icon.tsx';

describe('site favicons', () => {
  it('real API fetches /v2/favicon by normalized domain without third-party requests', () => {
    const { container } = render(<ApiProvider api={createHttpApi()}>
      <SiteIcon url="https://www.github.com/example" title="GitHub" />
    </ApiProvider>);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/v2/favicon?host=github.com');
  });

  it('falls back to initial letter on image error and avoids retrying same URL', () => {
    const { container, rerender } = render(<ApiProvider api={createHttpApi()}>
      <SiteIcon url="https://nothing.example.org/a" title="没有图标" />
    </ApiProvider>);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.site-icon')?.textContent).toBe('N');
    rerender(<ApiProvider api={createHttpApi()}>
      <SiteIcon url="https://nothing.example.org/b" title="x" />
    </ApiProvider>);
    expect(container.querySelector('img')).toBeNull();
  });

  it('non-http(s) URLs, IP addresses, or missing API fall back to initial letter', () => {
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    const { container } = render(<ApiProvider api={fake.api}>
      <SiteIcon url="file:///Users/a.html" title="本机文件" />
      <SiteIcon url="http://192.168.1.2/" title="路由器" />
    </ApiProvider>);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    const bare = render(<SiteIcon url="https://claude.ai/" title="Claude" />);
    expect(bare.container.querySelector('.site-icon')?.getAttribute('data-kind')).toBe('letter');
  });
});
