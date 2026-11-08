// 网站图标（11-08）：先用壳报来的，再用本体代取的（/v2/favicon，按域名），取不到画首字母；不是 http(s) 的网址不去取。

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../src/api/context.tsx';
import { createFakeApi } from '../../src/api/fake/index.ts';
import { createHttpApi } from '../../src/api/http/index.ts';
import { SiteIcon } from '../../src/shell/site-icon.tsx';

describe('网站图标', () => {
  it('真接口：按域名（去掉 www.）指向本体的 /v2/favicon，不找第三方', () => {
    const { container } = render(<ApiProvider api={createHttpApi()}>
      <SiteIcon url="https://www.github.com/example" title="GitHub" />
    </ApiProvider>);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/v2/favicon?host=github.com');
  });

  it('取不到（图片出错）就画首字母，同一个地址不再试', () => {
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

  it('不是 http(s)、IP 地址、没有接口：首字母', () => {
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
