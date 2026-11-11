// 按路由懒加载的视图（用户视角审查 2026-11-01 第 16 条 ④：生产首包一个 1.6 MB 的 chunk，TipTap 在今日页也要下载）。
// React.lazy 只认默认导出，这里把命名导出包一层；fallback 是 PageLoading 占位条（current-view / tool-panel）；入口空闲时会把它们全读进来。
// 加载失败（多半是断网或更新后旧 chunk 没了）会抛到 MainErrorBoundary，那里有「回今日」。
// 模块已经到手（预加载过，或之前打开过）时给 React 一个同步兑现的 thenable：React.lazy 看到它当场就是 Resolved，
// 不再闪一下 fallback；测试里 preloadLazyViews() 之后渲染就和静态导入一样是同步的。

import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Loaded<P> = { default: ComponentType<P> };

const loaders: Array<() => Promise<unknown>> = [];

function pick<P>(module: Record<string, unknown>, name: string): ComponentType<P> {
  const component = module[name];
  if (typeof component !== 'function') {
    throw new Error(`懒加载的模块里没有「${name}」这个组件`);
  }
  return component as ComponentType<P>;
}

/** 已经到手的模块：then 里当场回调，React.lazy 不必等一个微任务。 */
function settled<P>(value: Loaded<P>): Promise<Loaded<P>> {
  const thenable = {
    then(onFulfilled?: ((value: Loaded<P>) => unknown) | null): unknown {
      onFulfilled?.(value);
      return thenable;
    },
  };
  return thenable as unknown as Promise<Loaded<P>>;
}

export function lazyView<P extends object>(
  load: () => Promise<Record<string, unknown>>,
  name: string,
): LazyExoticComponent<ComponentType<P>> {
  let cached: ComponentType<P> | undefined;
  const resolve = async (): Promise<Loaded<P>> => {
    cached = pick<P>(await load(), name);
    return { default: cached };
  };
  loaders.push(resolve);
  return lazy(() => (cached === undefined ? resolve() : settled({ default: cached })));
}

/** 把所有懒加载的视图先读进来（测试在渲染前调用；别处想提前预热也可以）。 */
export async function preloadLazyViews(): Promise<void> {
  await Promise.all(loaders.map((load) => load()));
}

