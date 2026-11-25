import { afterEach, expect, it, vi } from 'vitest';
import { watchSegmented } from '../../src/shell/segmented-slide.ts';

afterEach(() => { document.body.innerHTML = ''; });

it('changing selection slides active ::before indicator from first item to second', async () => {
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
