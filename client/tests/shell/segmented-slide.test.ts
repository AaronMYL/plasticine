// 分段换一项时底块滑过去（11-15 动效一套，设计稿 19「切换」）：新那一项的底块从旧那一项的位置和宽度滑过来，180。

import { afterEach, expect, it, vi } from 'vitest';
import { watchSegmented } from '../../src/shell/segmented-slide.ts';

afterEach(() => { document.body.innerHTML = ''; });

it('选中从第一项换到第二项：第二项的 ::before 从第一项那里滑过来', async () => {
  document.body.innerHTML = '<div class="segmented"><button class="segmented-item" aria-pressed="true">全部</button>'
    + '<button class="segmented-item" aria-pressed="false">进行中</button></div>';
  const [first, second] = [...document.querySelectorAll<HTMLElement>('.segmented-item')];
  first!.getBoundingClientRect = () => ({ left: 10, width: 40 }) as DOMRect;
  second!.getBoundingClientRect = () => ({ left: 50, width: 80 }) as DOMRect;
  const animate = vi.fn();
  second!.animate = animate as unknown as HTMLElement['animate'];
  const stop = watchSegmented(document.body);
  first!.setAttribute('aria-pressed', 'false');
  second!.setAttribute('aria-pressed', 'true');
  await Promise.resolve();
  expect(animate).toHaveBeenCalledOnce();
  const [frames, options] = animate.mock.calls[0]!;
  expect(frames[0].transform).toBe('translateX(-40px) scaleX(0.5)');
  expect(options).toMatchObject({ duration: 180, pseudoElement: '::before' });
  stop();
});
